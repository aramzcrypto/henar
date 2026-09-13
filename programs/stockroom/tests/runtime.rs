//! Solana runtime tests with real SPL transfers and explicit upstream-program fixtures.
//! These do not claim live Kamino/ORAO/Pyth integration evidence.
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::solana_program::{program_error::ProgramError, program_pack::Pack as SplPack};
use anchor_lang::{prelude::*, AccountSerialize, InstructionData, ToAccountMetas};
use anchor_spl::{associated_token::spl_associated_token_account, token::spl_token};
use kvault_interface::{from_account_data, state::VaultState};
use solana_program::program::invoke_signed;
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account as SolanaAccount,
    instruction::Instruction,
    signature::{Keypair, Signer},
};
use stockroom::{accounts, instruction, state::*};

fn serialized<T: AccountSerialize>(state: &T) -> Vec<u8> {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap();
    data
}
fn account(data: Vec<u8>, owner: Pubkey) -> SolanaAccount {
    SolanaAccount {
        lamports: 100_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}
fn token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> SolanaAccount {
    let mut data = vec![0; spl_token::state::Account::LEN];
    spl_token::state::Account::pack(
        spl_token::state::Account {
            mint,
            owner,
            amount,
            state: spl_token::state::AccountState::Initialized,
            ..Default::default()
        },
        &mut data,
    )
    .unwrap();
    account(data, spl_token::ID)
}
fn mint_account(authority: Option<Pubkey>, supply: u64) -> SolanaAccount {
    let mut data = vec![0; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(
        spl_token::state::Mint {
            mint_authority: authority.into(),
            supply,
            decimals: 6,
            is_initialized: true,
            freeze_authority: None.into(),
        },
        &mut data,
    )
    .unwrap();
    account(data, spl_token::ID)
}
fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address(owner, mint)
}
fn vault_bytes(v: &VaultState) -> Vec<u8> {
    let mut data = solana_sha256_hasher::hash(b"account:VaultState").to_bytes()[..8].to_vec();
    data.extend(bytemuck::bytes_of(v));
    data
}
fn put_vault(info: &AccountInfo, v: &VaultState) -> ProgramResult {
    info.try_borrow_mut_data()?.copy_from_slice(&vault_bytes(v));
    Ok(())
}
fn mock_kamino(_id: &Pubkey, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let amount = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let is_deposit = data[..8] == solana_sha256_hasher::hash(b"global:deposit").to_bytes()[..8];
    let mut v = *from_account_data::<VaultState>(&a[1].try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let authority = Pubkey::find_program_address(&[b"mock-authority"], &KVAULT);
    let bump = [authority.1];
    let seeds = &[b"mock-authority".as_ref(), bump.as_ref()];
    let aum = (u128::from(v.prev_aum_sf) >> 60) as u64;
    if is_deposit {
        let shares = if v.shares_issued == 0 {
            amount
        } else {
            ((amount as u128) * (v.shares_issued as u128) / (aum as u128)) as u64
        };
        let transfer = spl_token::instruction::transfer(
            &spl_token::ID,
            a[6].key,
            a[2].key,
            a[0].key,
            &[],
            amount,
        )?;
        invoke_signed(
            &transfer,
            &[a[6].clone(), a[2].clone(), a[0].clone(), a[9].clone()],
            &[],
        )?;
        let mint = spl_token::instruction::mint_to(
            &spl_token::ID,
            a[5].key,
            a[7].key,
            a[4].key,
            &[],
            shares,
        )?;
        invoke_signed(
            &mint,
            &[a[5].clone(), a[7].clone(), a[4].clone(), a[10].clone()],
            &[seeds],
        )?;
        v.shares_issued += shares;
        v.token_available += amount;
        v.prev_aum_sf = (((aum + amount) as u128) << 60).into();
    } else {
        // Explicit local fixture cap to exercise partial reserve redemption.
        let amount = if v.min_withdraw_amount > 0 {
            amount.min(v.min_withdraw_amount)
        } else {
            amount
        };
        let redeemed = ((amount as u128) * (aum as u128) / (v.shares_issued as u128)) as u64;
        let burn = spl_token::instruction::burn(
            &spl_token::ID,
            a[7].key,
            a[8].key,
            a[0].key,
            &[],
            amount,
        )?;
        invoke_signed(
            &burn,
            &[a[7].clone(), a[8].clone(), a[0].clone(), a[10].clone()],
            &[],
        )?;
        let transfer = spl_token::instruction::transfer(
            &spl_token::ID,
            a[3].key,
            a[5].key,
            a[4].key,
            &[],
            redeemed,
        )?;
        invoke_signed(
            &transfer,
            &[a[3].clone(), a[5].clone(), a[4].clone(), a[9].clone()],
            &[seeds],
        )?;
        v.shares_issued -= amount;
        v.token_available -= redeemed;
        v.prev_aum_sf = (((aum - redeemed) as u128) << 60).into();
    }
    put_vault(&a[1], &v)
}
fn price_account(feed: [u8; 32], price: i64, publish: i64, full: bool) -> SolanaAccount {
    let mut data = solana_sha256_hasher::hash(b"account:PriceUpdateV2").to_bytes()[..8].to_vec();
    data.extend(Pubkey::default().to_bytes());
    data.push(if full { 1 } else { 0 });
    if !full {
        data.push(1);
    }
    data.extend(feed);
    data.extend(price.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    data.extend((-6i32).to_le_bytes());
    data.extend(publish.to_le_bytes());
    data.extend(publish.to_le_bytes());
    data.extend(price.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    data.extend(0u64.to_le_bytes());
    account(data, stockroom::oracle::PYTH_RECEIVER)
}
// Explicit local Jupiter fixture: real SPL transfers, not a live routing claim.
fn mock_jupiter(_id: &Pubkey, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let spend = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let output = u64::from_le_bytes(data[16..24].try_into().unwrap());
    if data.len() >= 35 {
        if data[34] == 254 {
            let steal = spl_token::instruction::transfer(
                &spl_token::ID,
                a[13].key,
                a[14].key,
                a[0].key,
                &[],
                1_000_000,
            )?;
            invoke_signed(
                &steal,
                &[a[13].clone(), a[14].clone(), a[0].clone(), a[5].clone()],
                &[],
            )?;
        }
        // Ordinary RouteV2 header layout used by position-swap tests.
        let input = spl_token::instruction::transfer(
            &spl_token::ID,
            a[1].key,
            a[10].key,
            a[0].key,
            &[],
            spend,
        )?;
        invoke_signed(
            &input,
            &[a[1].clone(), a[10].clone(), a[0].clone(), a[5].clone()],
            &[],
        )?;
        let bump = Pubkey::find_program_address(&[b"mock-dex"], &stockroom::pack_swap::JUPITER).1;
        // A final fixture byte asks the mock to under-deliver after debiting.
        let delivered = if data[34] == 255 {
            output.saturating_sub(1000)
        } else {
            output
        };
        let out = spl_token::instruction::transfer(
            &spl_token::ID,
            a[11].key,
            a[2].key,
            a[12].key,
            &[],
            delivered,
        )?;
        return invoke_signed(
            &out,
            &[a[11].clone(), a[2].clone(), a[12].clone(), a[5].clone()],
            &[&[b"mock-dex", &[bump]]],
        );
    }
    let input =
        spl_token::instruction::transfer(&spl_token::ID, a[1].key, a[2].key, a[0].key, &[], spend)?;
    invoke_signed(
        &input,
        &[a[1].clone(), a[2].clone(), a[0].clone(), a[6].clone()],
        &[],
    )?;
    let bump = Pubkey::find_program_address(&[b"mock-dex"], &stockroom::pack_swap::JUPITER).1;
    let seeds = &[b"mock-dex".as_ref(), &[bump]];
    let out = spl_token::instruction::transfer(
        &spl_token::ID,
        a[4].key,
        a[3].key,
        a[5].key,
        &[],
        output,
    )?;
    invoke_signed(
        &out,
        &[a[4].clone(), a[3].clone(), a[5].clone(), a[6].clone()],
        &[seeds],
    )
}
struct Fixture {
    fork_remaining: Vec<solana_sdk::instruction::AccountMeta>,
    fork_withdraw: Option<Vec<solana_sdk::instruction::AccountMeta>>,
    nonce: u32,
    ctx: ProgramTestContext,
    owner: Keypair,
    other: Keypair,
    solver: Keypair,
    config: Pubkey,
    manifest: Pubkey,
    mint: Pubkey,
    shares_mint: Pubkey,
    vault: Pubkey,
    vault_cash: Pubkey,
    vault_auth: Pubkey,
    treasury: Pubkey,
    stock_price: Pubkey,
    usdc_price: Pubkey,
}
impl Fixture {
    async fn new() -> Self {
        Self::setup(false).await
    }
    async fn setup(snapshot: bool) -> Self {
        use base64::Engine;
        let snapshot: Option<serde_json::Value> = if snapshot {
            Some(
                serde_json::from_slice(
                    &std::fs::read(concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/../../.cache/mainnet-snapshot/accounts.json"
                    ))
                    .expect("run snapshot-mainnet.ts first"),
                )
                .unwrap(),
            )
        } else {
            None
        };
        let mut fork_accounts = Vec::new();
        let mut fork_remaining = Vec::new();
        let mut fork_withdraw = None;
        if let Some(ref snapshot) = snapshot {
            for a in snapshot["accounts"].as_array().unwrap() {
                fork_accounts.push((
                    a["address"].as_str().unwrap().parse::<Pubkey>().unwrap(),
                    SolanaAccount {
                        lamports: a["lamports"].as_u64().unwrap(),
                        owner: a["owner"].as_str().unwrap().parse().unwrap(),
                        data: base64::engine::general_purpose::STANDARD
                            .decode(a["data"].as_str().unwrap())
                            .unwrap(),
                        executable: a["executable"].as_bool().unwrap(),
                        rent_epoch: 0,
                    },
                ));
            }
            let metas = |name: &str| {
                snapshot[name]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| solana_sdk::instruction::AccountMeta {
                        pubkey: a["pubkey"].as_str().unwrap().parse().unwrap(),
                        is_writable: a["isWritable"].as_bool().unwrap(),
                        is_signer: false,
                    })
                    .collect::<Vec<_>>()
            };
            fork_remaining = metas("remaining");
            fork_withdraw = Some(metas("withdraw"));
        }

        let owner = if snapshot.is_some() {
            <Keypair as solana_sdk::signature::SeedDerivable>::from_seed(&[42; 32]).unwrap()
        } else {
            Keypair::new()
        };
        let other = Keypair::new();
        let solver = Keypair::new();
        let admin = Pubkey::new_unique();
        let (config, cb) = Pubkey::find_program_address(&[b"config"], &stockroom::ID);
        let (manifest, mb) =
            Pubkey::find_program_address(&[b"manifest", &1u64.to_le_bytes()], &stockroom::ID);
        let mint = Pubkey::new_unique();
        let shares_mint = Pubkey::new_unique();
        let vault = Pubkey::new_unique();
        let vault_auth = Pubkey::find_program_address(&[b"mock-authority"], &KVAULT).0;
        let vault_cash = ata(&vault_auth, &USDC);
        let treasury = ata(&admin, &USDC);
        let stock_price = Pubkey::new_unique();
        let usdc_price = Pubkey::new_unique();
        let vault = snapshot
            .as_ref()
            .map(|s| s["vault"].as_str().unwrap().parse().unwrap())
            .unwrap_or(vault);
        let real_vault = fork_accounts
            .iter()
            .find(|(k, _)| *k == vault)
            .map(|(_, a)| *from_account_data::<VaultState>(&a.data).unwrap());
        let shares_mint = real_vault
            .as_ref()
            .map(|v| v.shares_mint)
            .unwrap_or(shares_mint);
        let vault_cash = real_vault
            .as_ref()
            .map(|v| v.token_vault)
            .unwrap_or(vault_cash);
        let vault_auth = real_vault
            .as_ref()
            .map(|v| v.base_vault_authority)
            .unwrap_or(vault_auth);
        let (execution, execution_bump) =
            Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID);
        let c = Config {
            admin,
            pending_admin: Pubkey::default(),
            treasury,
            vault,
            shares_mint,
            active_manifest: manifest,
            usdc_feed: [2; 32],
            yield_share_bps: 1000,
            pack_fee_bps: 200,
            trade_fee_bps: 25,
            max_slippage_bps: 50,
            max_confidence_bps: 100,
            oracle_max_age: 60,
            pack_timeout: 3600,
            paused: false,
            enabled_products: ALL_PRODUCTS,
            pilot_owner: Pubkey::default(),
            admission_limit: u64::MAX,
            admitted_usdc: 0,
            bump: cb,
        };
        let m = Manifest {
            config,
            sealed: true,
            version: 1,
            stocks: vec![StockSpec {
                mint,
                token_program: spl_token::ID,
                feed: [1; 32],
                ratio_numerator: 1,
                ratio_denominator: 1,
                decimals: 6,
                pack_eligible: true,
            }],
            created_at: 1000,
            bump: mb,
        };
        let mut v = bytemuck::Zeroable::zeroed();
        let v: &mut VaultState = &mut v;
        v.token_mint = USDC;
        v.token_mint_decimals = 6;
        v.token_program = spl_token::ID;
        v.shares_mint = shares_mint;
        v.shares_mint_decimals = 6;
        v.token_vault = vault_cash;
        v.base_vault_authority = vault_auth;
        let mut pt = ProgramTest::new("stockroom", stockroom::ID, None);
        pt.set_compute_max_units(1_400_000);
        pt.prefer_bpf(false);
        pt.add_program(
            "jupiter_fixture",
            stockroom::pack_swap::JUPITER,
            processor!(mock_jupiter),
        );
        if snapshot.is_none() {
            pt.add_program("kamino_fixture", KVAULT, processor!(mock_kamino));
        }
        for key in [owner.pubkey(), other.pubkey(), solver.pubkey(), vault_auth] {
            pt.add_account(
                key,
                SolanaAccount {
                    lamports: 10_000_000_000,
                    owner: anchor_lang::system_program::ID,
                    ..Default::default()
                },
            );
        }
        pt.add_account(
            execution,
            account(
                serialized(&stockroom::pack_swap::PackExecution {
                    authority: solver.pubkey(),
                    enabled: true,
                    max_budget: 1_000_000_000,
                    bump: execution_bump,
                }),
                stockroom::ID,
            ),
        );
        pt.add_account(config, account(serialized(&c), stockroom::ID));
        pt.add_account(manifest, account(serialized(&m), stockroom::ID));
        pt.add_account(vault, account(vault_bytes(v), KVAULT));
        pt.add_account(USDC, mint_account(None, 10_000_000_000));
        pt.add_account(mint, mint_account(None, 1_000_000_000));
        pt.add_account(shares_mint, mint_account(Some(vault_auth), 0));
        for owner_key in [owner.pubkey(), other.pubkey(), solver.pubkey()] {
            pt.add_account(
                ata(&owner_key, &USDC),
                token_account(USDC, owner_key, 1_000_000_000),
            );
            pt.add_account(
                ata(&owner_key, &mint),
                token_account(mint, owner_key, 100_000_000),
            );
        }
        pt.add_account(vault_cash, token_account(USDC, vault_auth, 0));
        pt.add_account(treasury, token_account(USDC, admin, 0));
        pt.add_account(stock_price, price_account([1; 32], 100_000_000, 1000, true));
        pt.add_account(usdc_price, price_account([2; 32], 1_000_000, 1000, true));
        for key in [
            KLEND,
            Pubkey::find_program_address(&[b"__event_authority"], &KVAULT).0,
        ] {
            pt.add_account(
                key,
                SolanaAccount {
                    lamports: 1_000_000,
                    owner: anchor_lang::system_program::ID,
                    ..Default::default()
                },
            );
        }
        // Load the exact snapshotted executable bytes under the immutable test loader.
        // ProgramTest's upgradeable-program cache cannot represent historical deployment slots reliably.
        let mut snapshot_programs = vec![KVAULT, KLEND, orao_solana_vrf::ID];
        if let Some(ref value) = snapshot {
            if let Some(programs) = value["pyth"]["programs"].as_array() {
                snapshot_programs.extend(
                    programs
                        .iter()
                        .map(|p| p.as_str().unwrap().parse::<Pubkey>().unwrap()),
                );
            }
        }
        for program in snapshot_programs {
            if let Some((_, entry)) = fork_accounts.iter().find(|(key, _)| *key == program) {
                if entry.owner != solana_sdk::bpf_loader_upgradeable::ID {
                    continue;
                }
                let data_key = Pubkey::new_from_array(entry.data[4..36].try_into().unwrap());
                let elf = fork_accounts
                    .iter()
                    .find(|(key, _)| *key == data_key)
                    .unwrap()
                    .1
                    .data[45..]
                    .to_vec();
                let index = fork_accounts
                    .iter()
                    .position(|(key, _)| *key == program)
                    .unwrap();
                fork_accounts[index].1 = SolanaAccount {
                    lamports: 100_000_000_000,
                    owner: solana_sdk::bpf_loader::ID,
                    data: elf,
                    executable: true,
                    rent_epoch: 0,
                };
            }
        }
        for (key, a) in fork_accounts {
            pt.add_account(key, a);
        }
        let mut ctx = pt.start_with_context().await;
        if let Some(ref snapshot) = snapshot {
            ctx.warp_to_slot(snapshot["slot"].as_u64().unwrap() + 1)
                .unwrap();
        }
        ctx.set_sysvar(&Clock {
            unix_timestamp: snapshot
                .as_ref()
                .map(|s| s["timestamp"].as_i64().unwrap())
                .unwrap_or(1000),
            slot: snapshot
                .as_ref()
                .map(|s| s["slot"].as_u64().unwrap())
                .unwrap_or(0),
            epoch: snapshot
                .as_ref()
                .map(|s| s["epoch"].as_u64().unwrap())
                .unwrap_or(0),
            ..Default::default()
        });
        Self {
            fork_remaining,
            fork_withdraw,
            nonce: 0,
            ctx,
            owner,
            other,
            solver,
            config,
            manifest,
            mint,
            shares_mint,
            vault,
            vault_cash,
            vault_auth,
            treasury,
            stock_price,
            usdc_price,
        }
    }
    async fn send(&mut self, ix: Instruction, who: u8) -> bool {
        self.nonce += 1;
        let signer = match who {
            1 => &self.other,
            2 => &self.solver,
            _ => &self.owner,
        };
        let blockhash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let needed = ix
            .accounts
            .iter()
            .any(|a| a.pubkey == signer.pubkey() && a.is_signer);
        let instructions = [
            solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(
                1_000_000 + self.nonce,
            ),
            ix,
        ];
        // Use the same V0 + lookup-table envelope as production, including packet size checks.
        let lookup_key = Pubkey::new_unique();
        let mut addresses = Vec::new();
        for instruction in &instructions {
            for a in &instruction.accounts {
                if !a.is_signer && !addresses.contains(&a.pubkey) {
                    addresses.push(a.pubkey);
                }
            }
        }
        let lookup = solana_sdk::address_lookup_table::state::AddressLookupTable {
            meta: Default::default(),
            addresses: std::borrow::Cow::Owned(addresses.clone()),
        };
        self.ctx.set_account(
            &lookup_key,
            &account(
                lookup.serialize_for_tests().unwrap(),
                solana_sdk::address_lookup_table::program::ID,
            )
            .into(),
        );
        let message = solana_sdk::message::v0::Message::try_compile(
            &self.ctx.payer.pubkey(),
            &instructions,
            &[solana_sdk::message::AddressLookupTableAccount {
                key: lookup_key,
                addresses,
            }],
            blockhash,
        )
        .unwrap();
        let mut signers = vec![&self.ctx.payer];
        if needed {
            signers.push(signer);
        }
        let tx = solana_sdk::transaction::VersionedTransaction::try_new(
            solana_sdk::message::VersionedMessage::V0(message),
            &signers,
        )
        .unwrap();
        assert!(
            bincode::serialize(&tx).unwrap().len() <= 1232,
            "Transaction exceeds Solana packet size"
        );
        let result = self
            .ctx
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        if result.result.is_err() {
            eprintln!("{:?} {:?}", result.result, result.metadata);
        }
        result.result.is_ok()
    }
    async fn balance(&mut self, key: Pubkey) -> u64 {
        let a = self
            .ctx
            .banks_client
            .get_account(key)
            .await
            .unwrap()
            .unwrap();
        spl_token::state::Account::unpack(&a.data).unwrap().amount
    }
    async fn state<T: AccountDeserialize>(&mut self, key: Pubkey) -> T {
        let a = self
            .ctx
            .banks_client
            .get_account(key)
            .await
            .unwrap()
            .unwrap();
        T::try_deserialize(&mut &a.data[..]).unwrap()
    }
    fn batch(&self, creator: Pubkey, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[b"batch", creator.as_ref(), &id.to_le_bytes()],
            &stockroom::ID,
        )
        .0
    }
    fn buy_ix(&self, id: u64, count: u64) -> Instruction {
        let batch = self.batch(self.owner.pubkey(), id);
        Instruction {
            program_id: stockroom::ID,
            accounts: accounts::BuyBatch {
                owner: self.owner.pubkey(),
                config: self.config,
                manifest: self.manifest,
                batch,
                usdc: USDC,
                owner_cash: ata(&self.owner.pubkey(), &USDC),
                batch_cash: ata(&batch, &USDC),
                token_program: spl_token::ID,
                associated_token_program: spl_associated_token_account::ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: instruction::BuyBatch {
                id,
                count,
                slippage_bps: 50,
            }
            .data(),
        }
    }
    fn deposit_metas(&self, p: Pubkey) -> Vec<solana_sdk::instruction::AccountMeta> {
        let ix = kvault_interface::instructions::deposit::deposit(
            kvault_interface::instructions::deposit::DepositAccounts {
                user: p,
                vault_state: self.vault,
                token_vault: self.vault_cash,
                token_mint: USDC,
                base_vault_authority: self.vault_auth,
                shares_mint: self.shares_mint,
                user_token_ata: ata(&p, &USDC),
                user_shares_ata: ata(&p, &self.shares_mint),
                klend_program: KLEND,
                token_program: spl_token::ID,
                shares_token_program: spl_token::ID,
            },
            1,
            self.fork_remaining.clone(),
        );
        ix.accounts
            .into_iter()
            .map(|mut m| {
                m.is_signer = false;
                m
            })
            .collect()
    }
    fn create_position_ix(&self, id: u64, amount: u64, kind: PositionKind) -> Instruction {
        let p = Pubkey::find_program_address(
            &[b"position", self.owner.pubkey().as_ref(), &id.to_le_bytes()],
            &stockroom::ID,
        )
        .0;
        let mut accts = accounts::CreatePosition {
            owner: self.owner.pubkey(),
            config: self.config,
            manifest: self.manifest,
            position: p,
            usdc: USDC,
            owner_cash: ata(&self.owner.pubkey(), &USDC),
            cash: ata(&p, &USDC),
            shares_mint: self.shares_mint,
            shares: ata(&p, &self.shares_mint),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        accts.extend(self.deposit_metas(p));
        Instruction {
            program_id: stockroom::ID,
            accounts: accts,
            data: instruction::CreatePosition {
                id,
                amount,
                min_shares: amount,
                terms: stockroom::positions::PositionTerms {
                    kind,
                    destination: Destination::Packs,
                    auto_packs: true,
                    stock_index: 0,
                    target_price: 100_000_000,
                    steps: 2,
                    interval_seconds: 3600,
                    expires_at: 100_000,
                    slippage_bps: 50,
                },
            }
            .data(),
        }
    }
}
#[tokio::test]
async fn purchased_batch_gifting_and_refunds_conserve_usdc() {
    let mut f = Fixture::new().await;
    let owner = f.owner.pubkey();
    let other = f.other.pubkey();
    let batch = f.batch(owner, 1);
    assert!(f.send(f.buy_ix(1, 5), 0).await);
    assert_eq!(f.balance(ata(&batch, &USDC)).await, 50_000_000);
    let b: PackBatch = f.state(batch).await;
    assert_eq!(b.remaining, 5);
    assert_eq!(b.unit_fee, 200_000);
    let gift = f.batch(owner, 2);
    let ix = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::GiftBatch {
            config: f.config,
            owner,
            batch,
            gift,
            usdc: USDC,
            batch_cash: ata(&batch, &USDC),
            gift_cash: ata(&gift, &USDC),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::GiftBatch {
            id: 2,
            count: 2,
            recipient: other,
            message: "For you".into(),
        }
        .data(),
    };
    assert!(f.send(ix, 0).await);
    let g: PackBatch = f.state(gift).await;
    assert_eq!(g.owner, other);
    assert_eq!(g.remaining, 2);
    assert_eq!(g.message, "For you");
    assert_eq!(f.balance(ata(&gift, &USDC)).await, 20_000_000);
    let refund = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::RefundBatch {
            owner: other,
            batch: gift,
            usdc: USDC,
            owner_cash: ata(&other, &USDC),
            batch_cash: ata(&gift, &USDC),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: instruction::RefundBatch { count: 2 }.data(),
    };
    assert!(f.send(refund.clone(), 1).await);
    assert_eq!(f.balance(ata(&other, &USDC)).await, 1_020_000_000);
    assert!(!f.send(refund, 1).await);
    let b: PackBatch = f.state(batch).await;
    assert_eq!(b.remaining, 3);
    assert_eq!(f.balance(f.treasury).await, 0);
}
#[tokio::test]
async fn wrong_owner_and_overflow_do_not_debit_escrow() {
    let mut f = Fixture::new().await;
    assert!(!f.send(f.buy_ix(1, u64::MAX), 0).await);
    assert!(f.send(f.buy_ix(2, 1), 0).await);
    let batch = f.batch(f.owner.pubkey(), 2);
    let other = f.other.pubkey();
    let refund = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::RefundBatch {
            owner: other,
            batch,
            usdc: USDC,
            owner_cash: ata(&other, &USDC),
            batch_cash: ata(&batch, &USDC),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: instruction::RefundBatch { count: 1 }.data(),
    };
    assert!(!f.send(refund, 1).await);
    assert_eq!(f.balance(ata(&batch, &USDC)).await, PACK_USDC);
}
#[tokio::test]
async fn deposit_custodies_real_shares_and_keeps_user_principal_exact() {
    let mut f = Fixture::new().await;
    let ix = f.create_position_ix(1, 100_000_000, PositionKind::Earn);
    assert!(f.send(ix, 0).await);
    let p = Pubkey::find_program_address(
        &[b"position", f.owner.pubkey().as_ref(), &1u64.to_le_bytes()],
        &stockroom::ID,
    )
    .0;
    let position: Position = f.state(p).await;
    assert_eq!(position.principal_basis, 100_000_000);
    assert_eq!(position.shares, 100_000_000);
    assert_eq!(position.claimable, 0);
    assert_eq!(f.balance(ata(&p, &f.shares_mint)).await, 100_000_000);
    assert_eq!(f.balance(ata(&p, &USDC)).await, 0);
    assert_eq!(f.balance(f.vault_cash).await, 100_000_000);
}

impl Fixture {
    fn position_key(&self, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[b"position", self.owner.pubkey().as_ref(), &id.to_le_bytes()],
            &stockroom::ID,
        )
        .0
    }
    fn manage(&self, p: Pubkey, actor: Pubkey) -> accounts::ManagePosition {
        accounts::ManagePosition {
            actor,
            config: self.config,
            position: p,
            manifest: self.manifest,
            usdc: USDC,
            owner_cash: ata(&self.owner.pubkey(), &USDC),
            cash: ata(&p, &USDC),
            shares_mint: self.shares_mint,
            shares: ata(&p, &self.shares_mint),
            treasury: self.treasury,
            token_program: spl_token::ID,
        }
    }
    fn withdraw_metas(&self, p: Pubkey) -> Vec<solana_sdk::instruction::AccountMeta> {
        if let Some(template) = &self.fork_withdraw {
            let mut accounts = template.clone();
            for group in accounts.chunks_mut(25 + self.fork_remaining.len()) {
                group[0].pubkey = p;
                group[5].pubkey = ata(&p, &USDC);
                group[7].pubkey = ata(&p, &self.shares_mint);
            }
            return accounts;
        }
        let ix = kvault_interface::instructions::withdraw::withdraw(
            kvault_interface::instructions::withdraw::WithdrawAccounts {
                user: p,
                vault_state: self.vault,
                global_config: self.vault_auth,
                token_vault: self.vault_cash,
                base_vault_authority: self.vault_auth,
                user_token_ata: ata(&p, &USDC),
                token_mint: USDC,
                user_shares_ata: ata(&p, &self.shares_mint),
                shares_mint: self.shares_mint,
                token_program: spl_token::ID,
                shares_token_program: spl_token::ID,
                klend_program: KLEND,
                invested_vault_state: self.vault,
                reserve: self.vault_auth,
                ctoken_vault: self.vault_cash,
                lending_market: self.vault_auth,
                lending_market_authority: self.vault_auth,
                reserve_liquidity_supply: self.vault_cash,
                reserve_collateral_mint: self.shares_mint,
                reserve_collateral_token_program: spl_token::ID,
                instruction_sysvar_account: solana_sdk::sysvar::instructions::ID,
            },
            1,
            vec![],
        );
        ix.accounts
            .into_iter()
            .map(|mut m| {
                m.is_signer = false;
                m
            })
            .collect()
    }
    async fn set_aum(&mut self, amount: u64) {
        let a = self
            .ctx
            .banks_client
            .get_account(self.vault)
            .await
            .unwrap()
            .unwrap();
        let mut v = *from_account_data::<VaultState>(&a.data).unwrap();
        v.prev_aum_sf = ((amount as u128) << 60).into();
        v.token_available = amount;
        self.ctx
            .set_account(&self.vault, &account(vault_bytes(&v), KVAULT).into());
        self.ctx.set_account(
            &self.vault_cash,
            &token_account(USDC, self.vault_auth, amount).into(),
        );
    }
    fn manage_ix(&self, p: Pubkey, data: Vec<u8>, actor: Pubkey, redeposit: bool) -> Instruction {
        let mut accounts = self.manage(p, actor).to_account_metas(None);
        accounts.extend(self.withdraw_metas(p));
        if redeposit {
            accounts.extend(self.deposit_metas(p));
        }
        Instruction {
            program_id: stockroom::ID,
            accounts,
            data,
        }
    }
    fn fixture_pack(&mut self, index: u64, source: PackSource) -> Pubkey {
        let batch = self.batch(self.owner.pubkey(), 99);
        let (key, bump) = Pubkey::find_program_address(
            &[b"pack", batch.as_ref(), &index.to_le_bytes()],
            &stockroom::ID,
        );
        let p = Pack {
            owner: self.owner.pubkey(),
            batch,
            config: self.config,
            manifest: self.manifest,
            index,
            force: [7; 32],
            unit_fee: if source == PackSource::Earned {
                0
            } else {
                200_000
            },
            slippage_bps: 50,
            stock_index: u16::MAX,
            source,
            status: PackStatus::Pending,
            units_received: 0,
            ui_multiplier_bits: 0x3ff0000000000000,
            stock_value: 0,
            created_at: 1000,
            expires_at: 4600,
            settled_at: 0,
            lucky: false,
            round: 0,
            stake: 0,
            budget: if source == PackSource::Purchased {
                9_800_000
            } else {
                PACK_USDC
            },
            bump,
        };
        self.ctx
            .set_account(&key, &account(serialized(&p), stockroom::ID).into());
        self.ctx.set_account(
            &ata(&key, &USDC),
            &token_account(USDC, key, PACK_USDC).into(),
        );
        key
    }
    fn randomness(&mut self, client: Pubkey, fulfilled: bool) -> Pubkey {
        use orao_solana_vrf::state::{
            FulfilledRequest, PendingRequest, RandomnessV2, RequestAccount,
        };
        let key = Pubkey::find_program_address(
            &[orao_solana_vrf::RANDOMNESS_ACCOUNT_SEED, &[7; 32]],
            &orao_solana_vrf::ID,
        )
        .0;
        let request = if fulfilled {
            RequestAccount::Fulfilled(FulfilledRequest {
                client,
                seed: [7; 32],
                randomness: [9; 64],
            })
        } else {
            RequestAccount::Pending(PendingRequest {
                client,
                seed: [7; 32],
                responses: vec![],
            })
        };
        self.ctx.set_account(
            &key,
            &account(serialized(&RandomnessV2 { request }), orao_solana_vrf::ID).into(),
        );
        key
    }
    fn resolve_ix(&self, pack: Pubkey, randomness: Pubkey) -> Instruction {
        Instruction {
            program_id: stockroom::ID,
            accounts: accounts::ResolvePack {
                pack,
                manifest: self.manifest,
                randomness,
            }
            .to_account_metas(None),
            data: instruction::ResolvePack {}.data(),
        }
    }
    fn settle_ix(&self, pack: Pubkey, delivered: u64) -> Instruction {
        Instruction {
            program_id: stockroom::ID,
            accounts: accounts::SettlePack {
                execution: Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID).0,
                solver: self.solver.pubkey(),
                config: self.config,
                pack,
                manifest: self.manifest,
                usdc: USDC,
                pack_cash: ata(&pack, &USDC),
                solver_cash: ata(&self.solver.pubkey(), &USDC),
                treasury: self.treasury,
                stock_mint: self.mint,
                solver_stock: ata(&self.solver.pubkey(), &self.mint),
                owner_stock: ata(&self.owner.pubkey(), &self.mint),
                stock_program: spl_token::ID,
                stock_price: self.stock_price,
                usdc_price: self.usdc_price,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: instruction::SettlePack { delivered }.data(),
        }
    }
}
#[tokio::test]
async fn harvest_multiple_earned_packs_never_spends_principal() {
    let mut f = Fixture::new().await;
    assert!(
        f.send(f.create_position_ix(1, 100_000_000, PositionKind::Earn), 0)
            .await
    );
    let p = f.position_key(1);
    f.set_aum(125_000_000).await;
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 5000,
        ..Default::default()
    });
    let ix = f.manage_ix(
        p,
        instruction::Harvest {
            withdraw_accounts: 25,
            min_redeemed: 125_000_000,
            min_shares: 100_000_000,
        }
        .data(),
        f.solver.pubkey(),
        true,
    );
    let mut pause_config: Config = f.state(f.config).await;
    pause_config.paused = true;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&pause_config), stockroom::ID).into(),
    );
    assert!(!f.send(ix.clone(), 2).await);
    pause_config.paused = false;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&pause_config), stockroom::ID).into(),
    );
    assert!(f.send(ix, 2).await);
    let position: Position = f.state(p).await;
    assert_eq!(position.principal_basis, 100_000_000);
    assert_eq!(position.claimable, 22_500_000);
    assert_eq!(position.gross_yield, 25_000_000);
    assert_eq!(position.yield_fees, 2_500_000);
    let batch = f.batch(f.solver.pubkey(), 8);
    let ix = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::YieldBatch {
            payer: f.solver.pubkey(),
            config: f.config,
            position: p,
            manifest: f.manifest,
            batch,
            usdc: USDC,
            position_cash: ata(&p, &USDC),
            batch_cash: ata(&batch, &USDC),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::YieldBatch { id: 8 }.data(),
    };
    assert!(f.send(ix, 2).await);
    let b: PackBatch = f.state(batch).await;
    let position: Position = f.state(p).await;
    assert_eq!(b.remaining, 2);
    assert_eq!(b.unit_fee, 0);
    assert_eq!(b.owner, f.owner.pubkey());
    assert_eq!(position.claimable, 2_500_000);
    assert_eq!(position.principal_basis, 100_000_000);
    assert_eq!(f.balance(ata(&batch, &USDC)).await, 20_000_000);
    let before = f.balance(ata(&f.owner.pubkey(), &USDC)).await;
    let ix = f.manage_ix(
        p,
        instruction::WithdrawPrincipal {
            amount: u64::MAX,
            withdraw_accounts: 25,
            min_redeemed: 100_000_000,
            min_shares: 0,
        }
        .data(),
        f.owner.pubkey(),
        false,
    );
    assert!(f.send(ix, 0).await);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &USDC)).await - before,
        100_000_000
    );
    let position: Position = f.state(p).await;
    assert_eq!(position.principal_basis, 0);
    assert_eq!(position.claimable, 2_500_000);
    assert_eq!(f.balance(f.treasury).await, 2_500_000);
}
#[tokio::test]
async fn vrf_binding_and_stock_delivery_are_enforced_atomically() {
    let mut f = Fixture::new().await;
    let pack = f.fixture_pack(0, PackSource::Purchased);
    let random = f.randomness(f.owner.pubkey(), false);
    assert!(!f.send(f.resolve_ix(pack, random), 0).await);
    f.randomness(f.other.pubkey(), true);
    assert!(!f.send(f.resolve_ix(pack, random), 0).await);
    f.randomness(f.owner.pubkey(), true);
    assert!(f.send(f.resolve_ix(pack, random), 0).await);
    let before = f.balance(ata(&f.owner.pubkey(), &f.mint)).await;
    assert!(!f.send(f.settle_ix(pack, 1), 2).await);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 10_000_000);
    assert_eq!(f.balance(ata(&f.owner.pubkey(), &f.mint)).await, before);
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 100_000_000, 900, true).into(),
    );
    assert!(!f.send(f.settle_ix(pack, 98_000), 2).await);
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 100_000_000, 1000, false).into(),
    );
    assert!(!f.send(f.settle_ix(pack, 98_000), 2).await);
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 100_000_000, 1000, true).into(),
    );
    assert!(f.send(f.settle_ix(pack, 98_000), 2).await);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &f.mint)).await - before,
        98_000
    );
    assert_eq!(f.balance(f.treasury).await, 200_000);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 0);
    assert!(!f.send(f.settle_ix(pack, 98_000), 2).await);
}
#[tokio::test]
async fn earned_pack_has_no_opening_fee_and_expired_pending_pack_refunds() {
    let mut f = Fixture::new().await;
    let pack = f.fixture_pack(0, PackSource::Earned);
    let random = f.randomness(f.owner.pubkey(), true);
    assert!(f.send(f.resolve_ix(pack, random), 0).await);
    assert!(f.send(f.settle_ix(pack, 100_000), 2).await);
    assert_eq!(f.balance(f.treasury).await, 0);
    let pending = f.fixture_pack(1, PackSource::Purchased);
    let refund = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::RefundPack {
            owner: f.owner.pubkey(),
            pack: pending,
            usdc: USDC,
            owner_cash: ata(&f.owner.pubkey(), &USDC),
            pack_cash: ata(&pending, &USDC),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: instruction::RefundPack {}.data(),
    };
    assert!(!f.send(refund.clone(), 0).await);
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 5000,
        ..Default::default()
    });
    assert!(f.send(refund.clone(), 0).await);
    assert!(!f.send(refund, 0).await);
    assert_eq!(f.balance(ata(&pending, &USDC)).await, 0);
}
#[tokio::test]
async fn scaled_token_2022_delivery_uses_exact_raw_units() {
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{
            scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensionsMut,
        },
        state::Mint,
    };
    let mut f = Fixture::new().await;
    let length =
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::ScaledUiAmount]).unwrap();
    let mut data = vec![0; length];
    let mut mint = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
    let scale = mint.init_extension::<ScaledUiAmountConfig>(true).unwrap();
    scale.multiplier = 1.5f64.into();
    scale.new_multiplier = 1.5f64.into();
    scale.new_multiplier_effective_timestamp = 0i64.into();
    mint.base = Mint {
        mint_authority: None.into(),
        supply: 1_000_000_000,
        decimals: 6,
        is_initialized: true,
        freeze_authority: None.into(),
    };
    mint.pack_base();
    mint.init_account_type().unwrap();
    f.ctx
        .set_account(&f.mint, &account(data, anchor_spl::token_2022::ID).into());
    for owner in [f.owner.pubkey(), f.solver.pubkey()] {
        let mut a = token_account(f.mint, owner, 100_000_000);
        a.owner = anchor_spl::token_2022::ID;
        f.ctx.set_account(&ata(&owner, &f.mint), &a.into());
    }
    let mut manifest: Manifest = f.state(f.manifest).await;
    manifest.stocks[0].token_program = anchor_spl::token_2022::ID;
    f.ctx.set_account(
        &f.manifest,
        &account(serialized(&manifest), stockroom::ID).into(),
    );
    let pack = f.fixture_pack(0, PackSource::Earned);
    let random = f.randomness(f.owner.pubkey(), true);
    assert!(f.send(f.resolve_ix(pack, random), 0).await);
    let mut ix = f.settle_ix(pack, 66_667);
    // SettlePack's stock_program precedes the two Pyth accounts and USDC token program.
    let index = ix.accounts.len() - 4;
    ix.accounts[index].pubkey = anchor_spl::token_2022::ID;
    assert!(f.send(ix, 2).await);
    let p: Pack = f.state(pack).await;
    assert_eq!(p.units_received, 66_667);
    assert_eq!(p.ui_multiplier_bits, 1.5f64.to_bits());
    assert_eq!(p.stock_value, 10_000_000);
}
#[tokio::test]
async fn limit_trigger_cancellation_and_dca_schedule() {
    let mut f = Fixture::new().await;
    assert!(
        f.send(f.create_position_ix(1, 100_000_000, PositionKind::Limit), 0)
            .await
    );
    let p = f.position_key(1);
    let mut accounts = accounts::SettlePosition {
        base: f.manage(p, f.solver.pubkey()),
        stock_mint: f.mint,
        solver_stock: ata(&f.solver.pubkey(), &f.mint),
        owner_stock: ata(&f.owner.pubkey(), &f.mint),
        stock_program: spl_token::ID,
        stock_price: f.stock_price,
        usdc_price: f.usdc_price,
        solver_cash: ata(&f.solver.pubkey(), &USDC),
    }
    .to_account_metas(None);
    accounts.extend(f.withdraw_metas(p));
    accounts.extend(f.deposit_metas(p));
    let ix = Instruction {
        program_id: stockroom::ID,
        accounts,
        data: instruction::FillOrder {
            delivered: 997_500,
            withdraw_accounts: 25,
            min_redeemed: 100_000_000,
            min_shares: 0,
            stock_transfer_accounts: 0,
        }
        .data(),
    };
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 101_000_000, 1000, true).into(),
    );
    assert!(!f.send(ix.clone(), 2).await);
    assert_eq!(f.balance(f.vault_cash).await, 100_000_000);
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 100_000_000, 1000, true).into(),
    );
    let mut pause_config: Config = f.state(f.config).await;
    pause_config.paused = true;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&pause_config), stockroom::ID).into(),
    );
    assert!(!f.send(ix.clone(), 2).await);
    pause_config.paused = false;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&pause_config), stockroom::ID).into(),
    );
    assert!(f.send(ix, 2).await);
    let filled: Position = f.state(p).await;
    assert_eq!(filled.status, PositionStatus::Filled);
    assert_eq!(filled.principal_basis, 0);
    assert_eq!(filled.stock_units_received, 997_500);
    assert!(
        f.send(f.create_position_ix(2, 100_000_000, PositionKind::Dca), 0)
            .await
    );
    let d = f.position_key(2);
    let mut accounts = accounts::SettlePosition {
        base: f.manage(d, f.solver.pubkey()),
        stock_mint: f.mint,
        solver_stock: ata(&f.solver.pubkey(), &f.mint),
        owner_stock: ata(&f.owner.pubkey(), &f.mint),
        stock_program: spl_token::ID,
        stock_price: f.stock_price,
        usdc_price: f.usdc_price,
        solver_cash: ata(&f.solver.pubkey(), &USDC),
    }
    .to_account_metas(None);
    accounts.extend(f.withdraw_metas(d));
    accounts.extend(f.deposit_metas(d));
    let ix = Instruction {
        program_id: stockroom::ID,
        accounts,
        data: instruction::FillOrder {
            delivered: 500_000,
            withdraw_accounts: 25,
            min_redeemed: 100_000_000,
            min_shares: 49_000_000,
            stock_transfer_accounts: 0,
        }
        .data(),
    };
    assert!(!f.send(ix.clone(), 2).await);
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 4600,
        ..Default::default()
    });
    f.ctx.set_account(
        &f.stock_price,
        &price_account([1; 32], 100_000_000, 4600, true).into(),
    );
    f.ctx.set_account(
        &f.usdc_price,
        &price_account([2; 32], 1_000_000, 4600, true).into(),
    );
    assert!(f.send(ix.clone(), 2).await);
    assert!(!f.send(ix, 2).await);
    let state: Position = f.state(d).await;
    assert_eq!(state.steps_remaining, 1);
    assert_eq!(state.principal_basis, 50_000_000);
    let wrong = f.manage_ix(
        d,
        instruction::CancelOrder {
            withdraw_accounts: 25,
            min_redeemed: 50_000_000,
        }
        .data(),
        f.other.pubkey(),
        false,
    );
    assert!(!f.send(wrong, 1).await);
    let before = f.balance(ata(&f.owner.pubkey(), &USDC)).await;
    let cancel = f.manage_ix(
        d,
        instruction::CancelOrder {
            withdraw_accounts: 25,
            min_redeemed: 50_000_000,
        }
        .data(),
        f.owner.pubkey(),
        false,
    );
    assert!(f.send(cancel, 0).await);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &USDC)).await - before,
        50_000_000
    );
}

#[tokio::test]
#[ignore = "requires public mainnet snapshot; no live fund movement"]
async fn deployed_kamino_snapshot_deposit_and_full_withdraw() {
    let mut f = Fixture::setup(true).await;
    let mut ix = f.create_position_ix(1, 100_000_000, PositionKind::Earn);
    ix.data[24..32].copy_from_slice(&1u64.to_le_bytes());
    assert!(f.send(ix, 0).await);
    let p = f.position_key(1);
    let position: Position = f.state(p).await;
    assert_eq!(position.principal_basis, 100_000_000);
    assert!(position.shares > 0);
    assert_eq!(f.balance(ata(&p, &f.shares_mint)).await, position.shares);
    let before = f.balance(ata(&f.owner.pubkey(), &USDC)).await;
    let count = f.withdraw_metas(p).len() as u16;
    let withdraw = f.manage_ix(
        p,
        instruction::WithdrawPrincipal {
            amount: u64::MAX,
            withdraw_accounts: count,
            min_redeemed: 99_000_000,
            min_shares: 0,
        }
        .data(),
        f.owner.pubkey(),
        false,
    );
    assert!(f.send(withdraw, 0).await);
    let returned = f.balance(ata(&f.owner.pubkey(), &USDC)).await - before;
    assert!(returned >= 99_000_000 && returned <= 100_000_000);
    let after: Position = f.state(p).await;
    assert_eq!(after.shares, 0);
    assert_eq!(after.principal_basis, 0);
}
#[tokio::test]
#[ignore = "requires public mainnet snapshot; no live randomness request"]
async fn deployed_orao_snapshot_creates_a_bound_pending_request() {
    let mut f = Fixture::setup(true).await;
    assert!(f.send(f.buy_ix(1, 2), 0).await);
    let owner = f.owner.pubkey();
    let batch = f.batch(owner, 1);
    let network = Pubkey::find_program_address(
        &[orao_solana_vrf::CONFIG_ACCOUNT_SEED],
        &orao_solana_vrf::ID,
    )
    .0;
    let state: orao_solana_vrf::state::NetworkState = f.state(network).await;
    let pack = Pubkey::find_program_address(
        &[b"pack", batch.as_ref(), &0u64.to_le_bytes()],
        &stockroom::ID,
    )
    .0;
    let nonce = [17; 32];
    let force = solana_sha256_hasher::hashv(&[
        b"stockroom-v1-vrf",
        stockroom::ID.as_ref(),
        pack.as_ref(),
        &nonce,
    ])
    .to_bytes();
    let randomness = Pubkey::find_program_address(
        &[orao_solana_vrf::RANDOMNESS_ACCOUNT_SEED, &force],
        &orao_solana_vrf::ID,
    )
    .0;
    let ix = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::OpenPack {
            owner,
            config: f.config,
            batch,
            pack,
            usdc: USDC,
            batch_cash: ata(&batch, &USDC),
            pack_cash: ata(&pack, &USDC),
            network,
            orao_treasury: state.config.treasury,
            randomness,
            orao_program: orao_solana_vrf::ID,
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::OpenPack { index: 0, nonce }.data(),
    };
    assert!(f.send(ix.clone(), 0).await);
    assert!(!f.send(ix, 0).await);
    let p: Pack = f.state(pack).await;
    assert_eq!(p.status, PackStatus::Pending);
    assert_eq!(p.force, force);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 10_000_000);
    let r: orao_solana_vrf::state::RandomnessV2 = f.state(randomness).await;
    assert_eq!(r.request.client(), &owner);
    assert_eq!(r.request.seed(), &force);
    assert!(r.fulfilled().is_none());
}

#[tokio::test]
#[ignore = "requires public mainnet snapshot; only test-wallet transactions execute locally"]
async fn deployed_pyth_full_verification_is_consumed_by_stockroom() {
    use base64::Engine;
    use solana_sdk::transaction::VersionedTransaction;
    let snapshot: serde_json::Value = serde_json::from_slice(
        &std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../.cache/mainnet-snapshot/accounts.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let mut f = Fixture::setup(true).await;
    for item in snapshot["pyth"]["transactions"].as_array().unwrap() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(item["transaction"].as_str().unwrap())
            .unwrap();
        let mut original: VersionedTransaction = bincode::deserialize(&bytes).unwrap();
        let hash = f.ctx.banks_client.get_latest_blockhash().await.unwrap();
        match &mut original.message {
            solana_sdk::message::VersionedMessage::Legacy(m) => m.recent_blockhash = hash,
            solana_sdk::message::VersionedMessage::V0(m) => m.recent_blockhash = hash,
        }
        // Current mainnet rent is lower than ProgramTest 2.3's Rent::default.
        // Adapt ONLY local account funding; signed VAA bytes and verifier instructions stay intact.
        let keys = original.message.static_account_keys().to_vec();
        let instructions = match &mut original.message {
            solana_sdk::message::VersionedMessage::Legacy(m) => &mut m.instructions,
            solana_sdk::message::VersionedMessage::V0(m) => &mut m.instructions,
        };
        for ix in instructions {
            if keys[ix.program_id_index as usize] == anchor_lang::system_program::ID {
                if let Ok(solana_sdk::system_instruction::SystemInstruction::CreateAccount {
                    lamports,
                    space,
                    owner,
                }) = bincode::deserialize(&ix.data)
                {
                    let local_rent = Rent::default().minimum_balance(space as usize);
                    ix.data = bincode::serialize(
                        &solana_sdk::system_instruction::SystemInstruction::CreateAccount {
                            lamports: lamports.max(local_rent),
                            space,
                            owner,
                        },
                    )
                    .unwrap();
                }
            }
        }
        let ephemeral: Vec<Keypair> = item["testSigners"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                Keypair::from_bytes(
                    &s.as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_u64().unwrap() as u8)
                        .collect::<Vec<_>>(),
                )
                .unwrap()
            })
            .collect();
        let mut signers = vec![&f.owner];
        signers.extend(ephemeral.iter());
        let tx = VersionedTransaction::try_new(original.message, &signers).unwrap();
        let result = f
            .ctx
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        assert!(result.result.is_ok(), "{:?}", result);
    }
    let feed = snapshot["pyth"]["feed"].as_str().unwrap();
    let price: Pubkey = snapshot["pyth"]["accounts"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let price_account = f
        .ctx
        .banks_client
        .get_account(price)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(price_account.owner, stockroom::oracle::PYTH_RECEIVER);
    assert_eq!(price_account.data[40], 1, "Full verification required");
    let mut feed_bytes = [0; 32];
    for i in 0..32 {
        feed_bytes[i] = u8::from_str_radix(&feed[i * 2..i * 2 + 2], 16).unwrap();
    }
    let mut config: Config = f.state(f.config).await;
    config.usdc_feed = feed_bytes;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&config), stockroom::ID).into(),
    );
    let mut manifest: Manifest = f.state(f.manifest).await;
    manifest.stocks[0].feed = feed_bytes;
    f.ctx.set_account(
        &f.manifest,
        &account(serialized(&manifest), stockroom::ID).into(),
    );
    f.stock_price = price;
    f.usdc_price = price;
    let pack = f.fixture_pack(0, PackSource::Earned);
    let mut state: Pack = f.state(pack).await;
    state.expires_at = snapshot["timestamp"].as_i64().unwrap() + 3600;
    f.ctx
        .set_account(&pack, &account(serialized(&state), stockroom::ID).into());
    let random = f.randomness(f.owner.pubkey(), true);
    assert!(f.send(f.resolve_ix(pack, random), 0).await);
    assert!(f.send(f.settle_ix(pack, 10_000_000), 2).await);
}

#[tokio::test]
async fn multi_reserve_redemption_completes_and_incomplete_routes_roll_back() {
    let mut f = Fixture::new().await;
    assert!(
        f.send(f.create_position_ix(1, 100_000_000, PositionKind::Earn), 0)
            .await
    );
    let p = f.position_key(1);
    let mut vault = f
        .ctx
        .banks_client
        .get_account(f.vault)
        .await
        .unwrap()
        .unwrap();
    let mut v = *from_account_data::<VaultState>(&vault.data).unwrap();
    v.min_withdraw_amount = 60_000_000; // mock-only per-reserve share capacity
    vault.data = vault_bytes(&v);
    f.ctx.set_account(&f.vault, &vault.into());
    let before = f.balance(ata(&f.owner.pubkey(), &USDC)).await;
    let one = f.manage_ix(
        p,
        instruction::WithdrawPrincipal {
            amount: u64::MAX,
            withdraw_accounts: 25,
            min_redeemed: 100_000_000,
            min_shares: 0,
        }
        .data(),
        f.owner.pubkey(),
        false,
    );
    assert!(!f.send(one, 0).await);
    assert_eq!(f.balance(ata(&p, &f.shares_mint)).await, 100_000_000);
    assert_eq!(f.balance(ata(&f.owner.pubkey(), &USDC)).await, before);
    let mut two = f.manage_ix(
        p,
        instruction::WithdrawPrincipal {
            amount: u64::MAX,
            withdraw_accounts: 50,
            min_redeemed: 100_000_000,
            min_shares: 0,
        }
        .data(),
        f.owner.pubkey(),
        false,
    );
    two.accounts.extend(f.withdraw_metas(p));
    assert!(f.send(two, 0).await);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &USDC)).await - before,
        100_000_000
    );
    let position: Position = f.state(p).await;
    assert_eq!(position.shares, 0);
    assert_eq!(position.principal_basis, 0);
}

impl Fixture {
    fn lucky_pool(&mut self, reserve: u64, enabled: bool) -> Pubkey {
        let (pool, bump) = Pubkey::find_program_address(&[b"lucky-pool"], &stockroom::ID);
        self.ctx.set_account(
            &pool,
            &account(
                serialized(&LuckyPool {
                    config: self.config,
                    enabled,
                    max_stake: 20_000_000,
                    bump,
                }),
                stockroom::ID,
            )
            .into(),
        );
        self.ctx.set_account(
            &ata(&pool, &USDC),
            &token_account(USDC, pool, reserve).into(),
        );
        pool
    }
    fn lucky_cash(&self, pack: Pubkey) -> accounts::LuckyCash {
        let pool = Pubkey::find_program_address(&[b"lucky-pool"], &stockroom::ID).0;
        accounts::LuckyCash {
            pack,
            pool,
            usdc: USDC,
            pool_cash: ata(&pool, &USDC),
            pack_cash: ata(&pack, &USDC),
            token_program: spl_token::ID,
        }
    }
    fn lucky_owner(&self, pack: Pubkey, randomness: Pubkey, owner: Pubkey) -> accounts::OwnerLucky {
        accounts::OwnerLucky {
            cash: self.lucky_cash(pack),
            owner,
            config: self.config,
            owner_cash: ata(&owner, &USDC),
            randomness,
        }
    }
    fn resolve_lucky_ix(&self, pack: Pubkey, randomness: Pubkey) -> Instruction {
        Instruction {
            program_id: stockroom::ID,
            accounts: accounts::ResolveLucky {
                cash: self.lucky_cash(pack),
                manifest: self.manifest,
                randomness,
            }
            .to_account_metas(None),
            data: instruction::ResolveLucky {}.data(),
        }
    }
    async fn fixture_lucky(&mut self, index: u64) -> Pubkey {
        let key = self.fixture_pack(index, PackSource::Purchased);
        let mut p: Pack = self.state(key).await;
        p.lucky = true;
        p.round = 1;
        p.stake = 9_800_000;
        p.budget = p.stake;
        p.unit_fee = 0;
        self.ctx
            .set_account(&key, &account(serialized(&p), stockroom::ID).into());
        self.ctx.set_account(
            &ata(&key, &USDC),
            &token_account(USDC, key, p.stake * 2).into(),
        );
        key
    }
}
#[tokio::test]
async fn lucky_escrow_resolution_bank_and_delivery_are_atomic() {
    let mut f = Fixture::new().await;
    let pool = f.lucky_pool(100_000_000, true);
    let pack = f.fixture_lucky(70).await;
    let random = f.randomness(f.owner.pubkey(), false);
    assert!(!f.send(f.resolve_lucky_ix(pack, random), 0).await);
    f.randomness(f.other.pubkey(), true);
    assert!(!f.send(f.resolve_lucky_ix(pack, random), 0).await);
    f.randomness(f.owner.pubkey(), true);
    // The ordinary resolution path may never bypass Lucky's payout allocation.
    assert!(!f.send(f.resolve_ix(pack, random), 0).await);
    assert!(f.send(f.resolve_lucky_ix(pack, random), 0).await);
    let p: Pack = f.state(pack).await;
    assert_eq!(p.status, PackStatus::LuckyReady);
    let bucket =
        stockroom::packs::sample_domain(&[9; 64], 100, b"kani-lucky-payout-v1").unwrap() as u8;
    assert_eq!(
        p.budget,
        stockroom_math::lucky_payout(p.stake, bucket).unwrap()
    );
    assert_eq!(f.balance(ata(&pack, &USDC)).await, p.budget);
    assert_eq!(
        f.balance(ata(&pool, &USDC)).await,
        100_000_000 + 2 * p.stake - p.budget
    );
    assert!(!f.send(f.resolve_lucky_ix(pack, random), 0).await);
    assert!(!f.send(f.settle_ix(pack, 1_000_000), 2).await);
    let bank = |f: &Fixture, owner| Instruction {
        program_id: stockroom::ID,
        accounts: f.lucky_owner(pack, random, owner).to_account_metas(None),
        data: instruction::BankLucky {}.data(),
    };
    assert!(!f.send(bank(&f, f.other.pubkey()), 1).await);
    // Pausing both products must not block banking already resolved funds.
    let mut config: Config = f.state(f.config).await;
    config.paused = true;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&config), stockroom::ID).into(),
    );
    let mut lp: LuckyPool = f.state(pool).await;
    lp.enabled = false;
    f.ctx
        .set_account(&pool, &account(serialized(&lp), stockroom::ID).into());
    assert!(f.send(bank(&f, f.owner.pubkey()), 0).await);
    assert!(!f.send(bank(&f, f.owner.pubkey()), 0).await);
    let before = f.balance(ata(&f.solver.pubkey(), &USDC)).await;
    assert!(!f.send(f.settle_ix(pack, 1), 2).await);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, p.budget);
    assert!(!f.send(f.settle_ix(pack, p.budget / 100), 2).await);
    config.paused = false;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&config), stockroom::ID).into(),
    );
    assert!(f.send(f.settle_ix(pack, p.budget / 100), 2).await);
    assert_eq!(
        f.balance(ata(&f.solver.pubkey(), &USDC)).await - before,
        p.budget
    );
    assert_eq!(f.balance(f.treasury).await, 0); // Fee was collected at opening, not banking.
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 0);
}
#[tokio::test]
async fn lucky_timeout_cannot_erase_a_fulfilled_loss() {
    let mut f = Fixture::new().await;
    let pool = f.lucky_pool(0, true);
    let pack = f.fixture_lucky(71).await;
    let random = f.randomness(f.owner.pubkey(), true);
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 5000,
        ..Default::default()
    });
    let refund = Instruction {
        program_id: stockroom::ID,
        accounts: f
            .lucky_owner(pack, random, f.owner.pubkey())
            .to_account_metas(None),
        data: instruction::RefundLucky {}.data(),
    };
    assert!(!f.send(refund, 0).await);
    let bypass = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::RefundPack {
            owner: f.owner.pubkey(),
            pack,
            usdc: USDC,
            owner_cash: ata(&f.owner.pubkey(), &USDC),
            pack_cash: ata(&pack, &USDC),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
        data: instruction::RefundPack {}.data(),
    };
    assert!(!f.send(bypass, 0).await);
    assert!(f.send(f.resolve_lucky_ix(pack, random), 0).await);
    let p: Pack = f.state(pack).await;
    assert_eq!(f.balance(ata(&pool, &USDC)).await, 2 * p.stake - p.budget);
}
#[tokio::test]
async fn lucky_unfulfilled_timeout_restores_stake_and_reserve_once() {
    let mut f = Fixture::new().await;
    let pool = f.lucky_pool(0, false);
    let pack = f.fixture_lucky(72).await;
    let random = f.randomness(f.owner.pubkey(), false);
    let refund = Instruction {
        program_id: stockroom::ID,
        accounts: f
            .lucky_owner(pack, random, f.owner.pubkey())
            .to_account_metas(None),
        data: instruction::RefundLucky {}.data(),
    };
    assert!(!f.send(refund.clone(), 0).await);
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 5000,
        ..Default::default()
    });
    let before = f.balance(ata(&f.owner.pubkey(), &USDC)).await;
    assert!(f.send(refund.clone(), 0).await);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &USDC)).await - before,
        9_800_000
    );
    assert_eq!(f.balance(ata(&pool, &USDC)).await, 9_800_000);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 0);
    assert!(!f.send(refund, 0).await);
    f.randomness(f.owner.pubkey(), true);
    assert!(!f.send(f.resolve_lucky_ix(pack, random), 0).await);
}

#[tokio::test]
#[ignore = "requires public mainnet ORAO snapshot; requests execute locally only"]
async fn deployed_orao_lucky_reserves_before_open_and_allows_only_one_rollover() {
    use orao_solana_vrf::state::{FulfilledRequest, RandomnessV2, RequestAccount};
    let mut f = Fixture::setup(true).await;
    let owner = f.owner.pubkey();
    let pool = f.lucky_pool(9_799_999, true);
    assert!(f.send(f.buy_ix(501, 1), 0).await);
    let batch = f.batch(owner, 501);
    let pack = Pubkey::find_program_address(
        &[b"pack", batch.as_ref(), &0u64.to_le_bytes()],
        &stockroom::ID,
    )
    .0;
    let network = Pubkey::find_program_address(
        &[orao_solana_vrf::CONFIG_ACCOUNT_SEED],
        &orao_solana_vrf::ID,
    )
    .0;
    let network_state: orao_solana_vrf::state::NetworkState = f.state(network).await;
    let nonce = [91; 32];
    let force = solana_sha256_hasher::hashv(&[
        b"stockroom-v1-vrf",
        stockroom::ID.as_ref(),
        pack.as_ref(),
        &nonce,
    ])
    .to_bytes();
    let random = Pubkey::find_program_address(
        &[orao_solana_vrf::RANDOMNESS_ACCOUNT_SEED, &force],
        &orao_solana_vrf::ID,
    )
    .0;
    let open = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::OpenLucky {
            base: accounts::OpenPack {
                owner,
                config: f.config,
                batch,
                pack,
                usdc: USDC,
                batch_cash: ata(&batch, &USDC),
                pack_cash: ata(&pack, &USDC),
                network,
                orao_treasury: network_state.config.treasury,
                randomness: random,
                orao_program: orao_solana_vrf::ID,
                token_program: spl_token::ID,
                associated_token_program: spl_associated_token_account::ID,
                system_program: anchor_lang::system_program::ID,
            },
            pool,
            pool_cash: ata(&pool, &USDC),
            treasury: f.treasury,
        }
        .to_account_metas(None),
        data: instruction::OpenLucky { index: 0, nonce }.data(),
    };
    assert!(!f.send(open.clone(), 0).await); // One micro-USDC short: no fee/request/debit.
    assert_eq!(f.balance(ata(&batch, &USDC)).await, 10_000_000);
    assert_eq!(f.balance(f.treasury).await, 0);
    f.lucky_pool(100_000_000, false);
    assert!(!f.send(open.clone(), 0).await);
    f.lucky_pool(100_000_000, true);
    assert!(f.send(open.clone(), 0).await);
    assert!(!f.send(open, 0).await);
    let p: Pack = f.state(pack).await;
    assert!(p.lucky);
    assert_eq!(p.round, 1);
    assert_eq!(p.unit_fee, 0);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 19_600_000);
    assert_eq!(f.balance(ata(&pool, &USDC)).await, 90_200_000);
    assert_eq!(f.balance(f.treasury).await, 200_000);
    let request: RandomnessV2 = f.state(random).await;
    assert_eq!(request.request.seed(), &force);
    assert_eq!(request.request.client(), &owner);
    assert!(request.fulfilled().is_none());
    // Explicit fulfillment fixture; no claim that a live oracle fulfilled this request.
    f.ctx.set_account(
        &random,
        &account(
            serialized(&RandomnessV2 {
                request: RequestAccount::Fulfilled(FulfilledRequest {
                    client: owner,
                    seed: force,
                    randomness: [9; 64],
                }),
            }),
            orao_solana_vrf::ID,
        )
        .into(),
    );
    assert!(f.send(f.resolve_lucky_ix(pack, random), 0).await);
    let resolved: Pack = f.state(pack).await;
    let nonce = [92; 32];
    let force2 = solana_sha256_hasher::hashv(&[
        b"kani-lucky-roll-v1",
        stockroom::ID.as_ref(),
        pack.as_ref(),
        &[2],
        &nonce,
    ])
    .to_bytes();
    let random2 = Pubkey::find_program_address(
        &[orao_solana_vrf::RANDOMNESS_ACCOUNT_SEED, &force2],
        &orao_solana_vrf::ID,
    )
    .0;
    let roll = Instruction {
        program_id: stockroom::ID,
        accounts: accounts::RollLucky {
            base: f.lucky_owner(pack, random2, owner),
            network,
            orao_treasury: network_state.config.treasury,
            orao_program: orao_solana_vrf::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: instruction::RollLucky { nonce }.data(),
    };
    assert!(f.send(roll.clone(), 0).await);
    let p2: Pack = f.state(pack).await;
    assert_eq!(p2.round, 2);
    assert_eq!(p2.stake, resolved.budget);
    assert_eq!(p2.force, force2);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, resolved.budget * 2);
    assert_eq!(f.balance(f.treasury).await, 200_000);
    f.ctx.set_account(
        &random2,
        &account(
            serialized(&RandomnessV2 {
                request: RequestAccount::Fulfilled(FulfilledRequest {
                    client: owner,
                    seed: force2,
                    randomness: [8; 64],
                }),
            }),
            orao_solana_vrf::ID,
        )
        .into(),
    );
    assert!(f.send(f.resolve_lucky_ix(pack, random2), 0).await);
    assert!(!f.send(roll, 0).await);
    let final_pack: Pack = f.state(pack).await;
    assert_eq!(final_pack.status, PackStatus::LuckyReady);
    assert_eq!(final_pack.stock_index, resolved.stock_index);
    assert_eq!(
        f.balance(ata(&pool, &USDC)).await
            + f.balance(ata(&pack, &USDC)).await
            + f.balance(f.treasury).await,
        110_000_000
    );
}

#[tokio::test]
async fn pack_swap_is_atomic_bounded_authorized_and_delivers_before_settled() {
    use solana_sdk::instruction::AccountMeta;
    use stockroom::pack_swap::{PackExecution, JUPITER};
    let mut f = Fixture::new().await;
    let pack = f.fixture_pack(77, PackSource::Purchased);
    let randomness = f.randomness(f.owner.pubkey(), true);
    assert!(f.send(f.resolve_ix(pack, randomness), 0).await);
    let (execution, bump) = Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID);
    f.ctx.set_account(
        &execution,
        &account(
            serialized(&PackExecution {
                authority: f.solver.pubkey(),
                enabled: true,
                max_budget: 40_000_000,
                bump,
            }),
            stockroom::ID,
        )
        .into(),
    );
    let dex = Pubkey::find_program_address(&[b"mock-dex"], &JUPITER).0;
    f.ctx.set_account(
        &dex,
        &account(vec![], anchor_lang::system_program::ID).into(),
    );
    f.ctx
        .set_account(&ata(&dex, &USDC), &token_account(USDC, dex, 0).into());
    f.ctx.set_account(
        &ata(&dex, &f.mint),
        &token_account(f.mint, dex, 1_000_000).into(),
    );
    let build = |f: &Fixture, spend: u64, output: u64, quote: u64, minimum: u64, at: i64| {
        let mut metas = accounts::SwapPack {
            quote_authority: f.solver.pubkey(),
            execution,
            config: f.config,
            pack,
            manifest: f.manifest,
            usdc: USDC,
            pack_cash: ata(&pack, &USDC),
            treasury: f.treasury,
            stock_mint: f.mint,
            owner_stock: ata(&f.owner.pubkey(), &f.mint),
            stock_program: spl_token::ID,
            token_program: spl_token::ID,
            jupiter: JUPITER,
        }
        .to_account_metas(None);
        metas.extend([
            AccountMeta::new_readonly(pack, false),
            AccountMeta::new(ata(&pack, &USDC), false),
            AccountMeta::new(ata(&dex, &USDC), false),
            AccountMeta::new(ata(&f.owner.pubkey(), &f.mint), false),
            AccountMeta::new(ata(&dex, &f.mint), false),
            AccountMeta::new_readonly(dex, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ]);
        Instruction {
            program_id: stockroom::ID,
            accounts: metas,
            data: instruction::SwapPack {
                quoted_output: quote,
                minimum_output: minimum,
                quoted_at: at,
                route: [
                    [187, 100, 250, 204, 49, 196, 175, 20],
                    spend.to_le_bytes(),
                    output.to_le_bytes(),
                ]
                .concat(),
            }
            .data(),
        }
    };
    let initial = f.balance(ata(&f.owner.pubkey(), &f.mint)).await;
    for (spend, output, quote, min, at) in [
        (9_800_001, 100_000, 100_000, 99_500, 1000), // fee overspend
        (9_799_999, 100_000, 100_000, 99_500, 1000), // incomplete allocation
        (9_800_000, 99_499, 100_000, 99_500, 1000),  // underdelivery after real transfers
        (9_800_000, 100_000, 100_000, 1, 1000),      // excessive slippage
        (9_800_000, 100_000, 100_000, 99_500, 969),  // stale quote
        (9_800_000, 100_000, 100_000, 99_500, 1001), // future quote
        (9_800_000, 0, 0, 0, 1000),
    ] {
        assert!(!f.send(build(&f, spend, output, quote, min, at), 2).await);
        assert_eq!(f.balance(ata(&pack, &USDC)).await, PACK_USDC);
        assert_eq!(f.balance(ata(&f.owner.pubkey(), &f.mint)).await, initial);
        assert_eq!(f.balance(f.treasury).await, 0);
        assert_eq!(f.state::<Pack>(pack).await.status, PackStatus::Selected);
    }
    let valid = build(&f, 9_800_000, 101_000, 100_000, 99_500, 1000);
    let mut unauthorized = valid.clone();
    unauthorized.accounts[0].pubkey = f.other.pubkey();
    assert!(!f.send(unauthorized, 1).await);
    let mut wrong_recipient = valid.clone();
    wrong_recipient.accounts[9].pubkey = ata(&dex, &f.mint);
    assert!(!f.send(wrong_recipient, 2).await);
    let mut wrong_router = valid.clone();
    wrong_router.accounts[12].pubkey = spl_token::ID;
    assert!(!f.send(wrong_router, 2).await);
    f.ctx.set_account(
        &execution,
        &account(
            serialized(&PackExecution {
                authority: f.solver.pubkey(),
                enabled: false,
                max_budget: 40_000_000,
                bump,
            }),
            stockroom::ID,
        )
        .into(),
    );
    assert!(!f.send(valid.clone(), 2).await);
    f.ctx.set_account(
        &execution,
        &account(
            serialized(&PackExecution {
                authority: f.solver.pubkey(),
                enabled: true,
                max_budget: 9_799_999,
                bump,
            }),
            stockroom::ID,
        )
        .into(),
    );
    assert!(!f.send(valid.clone(), 2).await);
    f.ctx.set_account(
        &execution,
        &account(
            serialized(&PackExecution {
                authority: f.solver.pubkey(),
                enabled: true,
                max_budget: 40_000_000,
                bump,
            }),
            stockroom::ID,
        )
        .into(),
    );
    assert!(f.send(valid.clone(), 2).await);
    let result = f.state::<Pack>(pack).await;
    assert_eq!(result.status, PackStatus::Settled);
    assert_eq!(result.units_received, 101_000); // All positive price improvement reaches owner.
    assert_eq!(result.stock_value, 9_800_000);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 0);
    assert_eq!(f.balance(f.treasury).await, 200_000);
    assert_eq!(
        f.balance(ata(&f.owner.pubkey(), &f.mint)).await,
        initial + 101_000
    );
    assert!(!f.send(valid, 2).await);
}

#[tokio::test]
#[ignore = "requires npm run packs:snapshot; uses captured mainnet Jupiter and issuer programs locally"]
async fn deployed_jupiter_pack_swap_delivers_stock_without_pyth() {
    use base64::Engine;
    use solana_sdk::{
        instruction::AccountMeta,
        message::{v0, VersionedMessage},
        signature::SeedDerivable,
        transaction::VersionedTransaction,
    };
    let snap: serde_json::Value = serde_json::from_slice(
        &std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../.cache/pack-swap-snapshot.json"
        ))
        .expect("Generate the pack swap snapshot first"),
    )
    .unwrap();
    let decode = |s: &str| base64::engine::general_purpose::STANDARD.decode(s).unwrap();
    let mut pt = ProgramTest::new("stockroom", stockroom::ID, None);
    pt.set_compute_max_units(1_400_000);
    let owner = Keypair::from_seed(&[42; 32]).unwrap();
    pt.add_account(
        owner.pubkey(),
        SolanaAccount {
            lamports: 100_000_000_000,
            owner: anchor_lang::system_program::ID,
            ..Default::default()
        },
    );
    let entries = snap["accounts"].as_array().unwrap();
    for a in entries {
        let mut entry = SolanaAccount {
            lamports: a["lamports"].as_u64().unwrap(),
            data: decode(a["data"].as_str().unwrap()),
            owner: a["owner"].as_str().unwrap().parse().unwrap(),
            executable: a["executable"].as_bool().unwrap(),
            rent_epoch: 0,
        };
        // Upgrade only the synthetic local config fixture from the previous capture schema.
        // This is not a production migration; the program has never been deployed.
        if a["address"].as_str().unwrap()
            == Pubkey::find_program_address(&[b"config"], &stockroom::ID)
                .0
                .to_string()
            && entry.data.len() == 8 + Config::INIT_SPACE - 49
        {
            let bump = entry.data.pop().unwrap();
            entry.data.push(ALL_PRODUCTS);
            entry.data.extend_from_slice(&[0; 32]);
            entry.data.extend_from_slice(&u64::MAX.to_le_bytes());
            entry.data.extend_from_slice(&0u64.to_le_bytes());
            entry.data.push(bump);
        }
        if entry.executable && entry.owner == solana_sdk::bpf_loader_upgradeable::ID {
            let data_key = Pubkey::new_from_array(entry.data[4..36].try_into().unwrap());
            let data = entries
                .iter()
                .find(|x| x["address"].as_str().unwrap() == data_key.to_string())
                .unwrap();
            entry.data = decode(data["data"].as_str().unwrap())[45..].to_vec();
            entry.owner = solana_sdk::bpf_loader::ID;
            entry.lamports = 100_000_000_000;
        }
        pt.add_account(a["address"].as_str().unwrap().parse().unwrap(), entry);
    }
    let mut ctx = pt.start_with_context().await;
    ctx.warp_to_slot(snap["slot"].as_u64().unwrap() + 1)
        .unwrap();
    ctx.set_sysvar(&Clock {
        unix_timestamp: snap["timestamp"].as_i64().unwrap(),
        slot: snap["slot"].as_u64().unwrap(),
        epoch: snap["epoch"].as_u64().unwrap(),
        ..Default::default()
    });
    let mut ix = vec![
        solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
    ];
    for item in snap["instructions"].as_array().unwrap() {
        ix.push(Instruction {
            program_id: item["programId"].as_str().unwrap().parse().unwrap(),
            accounts: item["keys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| AccountMeta {
                    pubkey: k["pubkey"].as_str().unwrap().parse().unwrap(),
                    is_signer: k["isSigner"].as_bool().unwrap(),
                    is_writable: k["isWritable"].as_bool().unwrap(),
                })
                .collect(),
            data: decode(item["data"].as_str().unwrap()),
        });
    }
    // A test lookup table changes message encoding only; all route account state and binaries are captured.
    let mut addresses = Vec::new();
    for i in &ix {
        for a in &i.accounts {
            if !a.is_signer && !addresses.contains(&a.pubkey) {
                addresses.push(a.pubkey);
            }
        }
    }
    let table_key = Pubkey::new_unique();
    let table = solana_sdk::address_lookup_table::state::AddressLookupTable {
        meta: Default::default(),
        addresses: std::borrow::Cow::Owned(addresses.clone()),
    }
    .serialize_for_tests()
    .unwrap();
    ctx.set_account(
        &table_key,
        &account(table, solana_sdk::address_lookup_table::program::ID).into(),
    );
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let message = v0::Message::try_compile(
        &owner.pubkey(),
        &ix,
        &[
            solana_sdk::address_lookup_table::AddressLookupTableAccount {
                key: table_key,
                addresses,
            },
        ],
        blockhash,
    )
    .unwrap();
    let tx = VersionedTransaction::try_new(VersionedMessage::V0(message), &[&owner]).unwrap();
    assert!(bincode::serialize(&tx).unwrap().len() <= 1232);
    let result = ctx
        .banks_client
        .process_transaction_with_metadata(tx)
        .await
        .unwrap();
    if result.result.is_err() {
        eprintln!("{:?} {:?}", result.result, result.metadata);
    }
    assert!(
        result.result.is_ok(),
        "Actual Jupiter CPI must settle without any Pyth accounts"
    );
    let key: Pubkey = snap["pack"].as_str().unwrap().parse().unwrap();
    let p = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    let p = Pack::try_deserialize(&mut &p.data[..]).unwrap();
    assert_eq!(p.status, PackStatus::Settled);
    assert!(p.units_received >= snap["minimum"].as_str().unwrap().parse::<u64>().unwrap());
    assert_eq!(p.stock_value, 9_800_000);
    let destination = ctx
        .banks_client
        .get_account(snap["destination"].as_str().unwrap().parse().unwrap())
        .await
        .unwrap()
        .unwrap();
    let actual = u64::from_le_bytes(destination.data[64..72].try_into().unwrap());
    assert_eq!(actual, p.units_received);
    let cash = ctx
        .banks_client
        .get_account(ata(&key, &USDC))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        spl_token::state::Account::unpack(&cash.data)
            .unwrap()
            .amount,
        0
    );
    let fee = ctx
        .banks_client
        .get_account(snap["treasury"].as_str().unwrap().parse().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        spl_token::state::Account::unpack(&fee.data).unwrap().amount,
        200_000
    );
}

#[tokio::test]
async fn pilot_admission_caps_all_deposits_and_keeps_owner_exit_open() {
    let mut f = Fixture::new().await;
    let mut c: Config = f.state(f.config).await;
    c.enabled_products = PRODUCT_EARN | PRODUCT_PACKS;
    c.pilot_owner = f.other.pubkey();
    c.admission_limit = 100_000_000;
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    assert!(
        !f.send(f.create_position_ix(101, 90_000_000, PositionKind::Earn), 0)
            .await
    );
    assert_eq!(f.state::<Config>(f.config).await.admitted_usdc, 0);
    c.pilot_owner = f.owner.pubkey();
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    assert!(
        !f.send(
            f.create_position_ix(101, 90_000_000, PositionKind::Limit),
            0
        )
        .await
    );
    assert!(
        !f.send(f.create_position_ix(101, 90_000_000, PositionKind::Dca), 0)
            .await
    );
    assert!(
        f.send(f.create_position_ix(101, 90_000_000, PositionKind::Earn), 0)
            .await
    );
    let p = f.position_key(101);
    let mut accts = f.manage(p, f.owner.pubkey()).to_account_metas(None);
    accts.extend(f.deposit_metas(p));
    assert!(
        !f.send(
            Instruction {
                program_id: stockroom::ID,
                accounts: accts,
                data: instruction::DepositMore {
                    amount: 11_000_000,
                    min_shares: 11_000_000
                }
                .data()
            },
            0
        )
        .await
    );
    assert_eq!(f.state::<Config>(f.config).await.admitted_usdc, 90_000_000);
    assert!(f.send(f.buy_ix(102, 1), 0).await);
    assert!(!f.send(f.buy_ix(103, 1), 0).await);
    assert_eq!(f.state::<Config>(f.config).await.admitted_usdc, 100_000_000);
    // Emergency stop must preserve the original depositor's withdrawal.
    c = f.state(f.config).await;
    c.paused = true;
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    let ix = f.manage_ix(
        p,
        instruction::WithdrawPrincipal {
            amount: u64::MAX,
            withdraw_accounts: 25,
            min_redeemed: 90_000_000,
            min_shares: 0,
        }
        .data(),
        f.owner.pubkey(),
        true,
    );
    assert!(f.send(ix, 0).await);
    c = f.state(f.config).await;
    assert_eq!(c.admitted_usdc, 100_000_000);
    c.paused = false;
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    assert!(
        !f.send(f.create_position_ix(104, 1_000_000, PositionKind::Earn), 0)
            .await
    );
}

#[tokio::test]
async fn legacy_pack_delivery_obeys_both_execution_and_global_stops() {
    use stockroom::pack_swap::PackExecution;
    let mut f = Fixture::new().await;
    let pack = f.fixture_pack(777, PackSource::Purchased);
    let mut p: Pack = f.state(pack).await;
    p.status = PackStatus::Selected;
    p.stock_index = 0;
    f.ctx
        .set_account(&pack, &account(serialized(&p), stockroom::ID).into());
    let key = Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID).0;
    let mut execution: PackExecution = f.state(key).await;
    execution.enabled = false;
    f.ctx
        .set_account(&key, &account(serialized(&execution), stockroom::ID).into());
    assert!(!f.send(f.settle_ix(pack, 100_000), 2).await);
    execution.enabled = true;
    f.ctx
        .set_account(&key, &account(serialized(&execution), stockroom::ID).into());
    let mut c: Config = f.state(f.config).await;
    c.paused = true;
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    assert!(!f.send(f.settle_ix(pack, 100_000), 2).await);
    assert_eq!(f.balance(ata(&pack, &USDC)).await, 10_000_000);
    c.paused = false;
    f.ctx
        .set_account(&f.config, &account(serialized(&c), stockroom::ID).into());
    assert!(f.send(f.settle_ix(pack, 100_000), 2).await);
}

impl Fixture {
    fn prepare_position_dex(&mut self) {
        use stockroom::pack_swap::{PackExecution, JUPITER};
        let (execution, bump) = Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID);
        self.ctx.set_account(
            &execution,
            &account(
                serialized(&PackExecution {
                    authority: self.solver.pubkey(),
                    enabled: true,
                    max_budget: 40_000_000,
                    bump,
                }),
                stockroom::ID,
            )
            .into(),
        );
        let dex = Pubkey::find_program_address(&[b"mock-dex"], &JUPITER).0;
        let event = Pubkey::find_program_address(&[b"__event_authority"], &JUPITER).0;
        for key in [dex, event] {
            self.ctx.set_account(
                &key,
                &account(vec![], anchor_lang::system_program::ID).into(),
            );
        }
        self.ctx
            .set_account(&ata(&dex, &USDC), &token_account(USDC, dex, 0).into());
        self.ctx.set_account(
            &ata(&dex, &self.mint),
            &token_account(self.mint, dex, 1_000_000_000).into(),
        );
    }
    fn position_swap_ix(
        &self,
        p: Pubkey,
        input: u64,
        output: u64,
        withdraw: bool,
        deposit: bool,
    ) -> Instruction {
        use solana_sdk::instruction::AccountMeta as M;
        use stockroom::pack_swap::JUPITER;
        let execution = Pubkey::find_program_address(&[b"pack-execution"], &stockroom::ID).0;
        let dex = Pubkey::find_program_address(&[b"mock-dex"], &JUPITER).0;
        let event = Pubkey::find_program_address(&[b"__event_authority"], &JUPITER).0;
        let mut accounts = accounts::SwapPosition {
            base: self.manage(p, self.solver.pubkey()),
            execution,
            stock_mint: self.mint,
            owner_stock: ata(&self.owner.pubkey(), &self.mint),
            stock_program: spl_token::ID,
            jupiter: JUPITER,
        }
        .to_account_metas(None);
        let w = if withdraw {
            self.withdraw_metas(p)
        } else {
            vec![]
        };
        let d = if deposit {
            self.deposit_metas(p)
        } else {
            vec![]
        };
        let terms = stockroom::position_swap::PositionSwapTerms {
            input,
            quoted_output: output,
            minimum_output: (output as u128 * 9950 + 9999).checked_div(10000).unwrap() as u64,
            quoted_at: 1000,
            withdraw_accounts: w.len() as u16,
            deposit_accounts: d.len() as u16,
            minimum_redeemed: 0,
            minimum_shares: if deposit { 1 } else { 0 },
        };
        accounts.extend(w);
        accounts.extend(d);
        accounts.extend([
            M::new_readonly(p, false),
            M::new(ata(&p, &USDC), false),
            M::new(ata(&self.owner.pubkey(), &self.mint), false),
            M::new_readonly(USDC, false),
            M::new_readonly(self.mint, false),
            M::new_readonly(spl_token::ID, false),
            M::new_readonly(spl_token::ID, false),
            M::new_readonly(JUPITER, false),
            M::new_readonly(event, false),
            M::new_readonly(JUPITER, false),
            M::new(ata(&dex, &USDC), false),
            M::new(ata(&dex, &self.mint), false),
            M::new_readonly(dex, false),
        ]);
        let mut route = vec![187, 100, 250, 204, 49, 196, 175, 20];
        route.extend(input.to_le_bytes());
        route.extend(output.to_le_bytes());
        route.extend(50u16.to_le_bytes());
        route.extend([0; 4]);
        route.extend(1u32.to_le_bytes());
        route.push(0);
        Instruction {
            program_id: stockroom::ID,
            accounts,
            data: instruction::SwapPosition { terms, route }.data(),
        }
    }
}
#[tokio::test]
async fn position_swap_limit_checks_actual_delivery_fee_and_atomic_rollback() {
    let mut f = Fixture::new().await;
    f.prepare_position_dex();
    assert!(
        f.send(
            f.create_position_ix(901, 10_000_000, PositionKind::Limit),
            0
        )
        .await
    );
    let p = f.position_key(901);
    let before = f.balance(ata(&f.owner.pubkey(), &f.mint)).await;
    // Target $100: the 25,000 USDC-base-unit fee must also fit the price.
    for output in [99_000, 99_750] {
        assert!(
            !f.send(f.position_swap_ix(p, 9_975_000, output, true, false), 2)
                .await
        );
        assert_eq!(f.state::<Position>(p).await.shares, 10_000_000);
        assert_eq!(f.balance(ata(&f.owner.pubkey(), &f.mint)).await, before);
    }
    let valid = f.position_swap_ix(p, 9_975_000, 100_000, true, false);
    let mut stale = valid.clone();
    let mut terms =
        stockroom::position_swap::PositionSwapTerms::deserialize(&mut &stale.data[8..]).unwrap();
    terms.quoted_at = 969;
    let route = valid.data[valid.data.len() - 35..].to_vec();
    stale.data = instruction::SwapPosition {
        terms,
        route: route.clone(),
    }
    .data();
    assert!(!f.send(stale, 2).await);
    let mut wrong = valid.clone();
    wrong.accounts[0].pubkey = f.other.pubkey();
    assert!(!f.send(wrong, 1).await);
    let mut under = valid.clone();
    *under.data.last_mut().unwrap() = 255;
    assert!(!f.send(under, 2).await);
    assert_eq!(f.state::<Position>(p).await.shares, 10_000_000);
    assert!(f.send(valid.clone(), 2).await);
    let state = f.state::<Position>(p).await;
    assert_eq!(state.status, PositionStatus::Filled);
    assert_eq!(state.principal_basis, 0);
    assert_eq!(state.shares, 0);
    assert_eq!(state.stock_units_received, 100_000);
    assert_eq!(f.balance(f.treasury).await, 25_000);
    assert!(!f.send(valid, 2).await);
}
#[tokio::test]
async fn position_swap_dca_preserves_remaining_principal_and_schedule() {
    let mut f = Fixture::new().await;
    f.prepare_position_dex();
    assert!(
        f.send(f.create_position_ix(902, 20_000_000, PositionKind::Dca), 0)
            .await
    );
    let p = f.position_key(902);
    let mut ix = f.position_swap_ix(p, 9_965_000, 100_000, true, true);
    assert!(!f.send(ix.clone(), 2).await);
    f.ctx.set_sysvar(&Clock {
        unix_timestamp: 4600,
        ..Default::default()
    });
    let mut bytes = &ix.data[8..];
    let mut terms = stockroom::position_swap::PositionSwapTerms::deserialize(&mut bytes).unwrap();
    let route = Vec::<u8>::deserialize(&mut bytes).unwrap();
    terms.quoted_at = 4600;
    ix.data = instruction::SwapPosition { terms, route }.data();
    assert!(f.send(ix.clone(), 2).await);
    let state = f.state::<Position>(p).await;
    assert_eq!(state.steps_remaining, 1);
    assert_eq!(state.principal_basis, 10_000_000);
    assert_eq!(state.shares, 10_000_000 + state.invested_fee_basis);
    assert_eq!(state.next_fill_at, 8200);
    assert_eq!(state.stock_usdc_spent, 9_965_000);
    assert_eq!(
        f.balance(f.treasury).await + state.invested_fee_basis,
        25_000
    );
    assert!(!f.send(ix, 2).await);
    assert_eq!(f.state::<Position>(p).await.shares, state.shares);
}
#[tokio::test]
async fn position_swap_yield_never_spends_principal_and_respects_pause() {
    let mut f = Fixture::new().await;
    f.prepare_position_dex();
    assert!(
        f.send(f.create_position_ix(903, 10_000_000, PositionKind::Earn), 0)
            .await
    );
    let p = f.position_key(903);
    let mut state = f.state::<Position>(p).await;
    state.destination = Destination::Stocks;
    state.claimable = 2_000_000;
    f.ctx
        .set_account(&p, &account(serialized(&state), stockroom::ID).into());
    f.ctx
        .set_account(&ata(&p, &USDC), &token_account(USDC, p, 2_000_000).into());
    assert!(
        !f.send(f.position_swap_ix(p, 2_000_001, 20_000, false, false), 2)
            .await
    );
    let ix = f.position_swap_ix(p, 2_000_000, 20_000, false, false);
    let mut config = f.state::<Config>(f.config).await;
    config.paused = true;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&config), stockroom::ID).into(),
    );
    assert!(!f.send(ix.clone(), 2).await);
    config.paused = false;
    f.ctx.set_account(
        &f.config,
        &account(serialized(&config), stockroom::ID).into(),
    );
    let mut steal_shares = ix.clone();
    *steal_shares.data.last_mut().unwrap() = 254;
    let dex = Pubkey::find_program_address(&[b"mock-dex"], &stockroom::pack_swap::JUPITER).0;
    f.ctx.set_account(
        &ata(&dex, &f.shares_mint),
        &token_account(f.shares_mint, dex, 0).into(),
    );
    steal_shares.accounts.extend([
        solana_sdk::instruction::AccountMeta::new(ata(&p, &f.shares_mint), false),
        solana_sdk::instruction::AccountMeta::new(ata(&dex, &f.shares_mint), false),
    ]);
    assert!(!f.send(steal_shares, 2).await);
    assert_eq!(f.state::<Position>(p).await.shares, 10_000_000);
    assert!(f.send(ix.clone(), 2).await);
    let state = f.state::<Position>(p).await;
    assert_eq!(state.principal_basis, 10_000_000);
    assert_eq!(state.shares, 10_000_000);
    assert_eq!(state.claimable, 0);
    assert_eq!(state.allocated_yield, 2_000_000);
    assert!(!f.send(ix, 2).await);
}

async fn run_position_snapshot(kind: &str) {
    use base64::Engine;
    use solana_sdk::{
        instruction::AccountMeta,
        message::{v0, VersionedMessage},
        signature::SeedDerivable,
        transaction::VersionedTransaction,
    };
    let snap: serde_json::Value = serde_json::from_slice(
        &std::fs::read(format!(
            "{}/../../.cache/position-swap-snapshot-{}.json",
            env!("CARGO_MANIFEST_DIR"),
            kind
        ))
        .expect("Run snapshot-position-swap first"),
    )
    .unwrap();
    let decode = |s: &str| base64::engine::general_purpose::STANDARD.decode(s).unwrap();
    let mut pt = ProgramTest::new("stockroom", stockroom::ID, None);
    pt.set_compute_max_units(1_400_000);
    let owner = Keypair::from_seed(&[42; 32]).unwrap();
    pt.add_account(
        owner.pubkey(),
        SolanaAccount {
            lamports: 100_000_000_000,
            owner: anchor_lang::system_program::ID,
            ..Default::default()
        },
    );
    let entries = snap["accounts"].as_array().unwrap();
    for a in entries {
        let mut entry = SolanaAccount {
            lamports: a["lamports"].as_u64().unwrap(),
            data: decode(a["data"].as_str().unwrap()),
            owner: a["owner"].as_str().unwrap().parse().unwrap(),
            executable: a["executable"].as_bool().unwrap(),
            rent_epoch: 0,
        };
        // Upgrade only the synthetic local config fixture from the previous capture schema.
        // This is not a production migration; the program has never been deployed.
        if a["address"].as_str().unwrap()
            == Pubkey::find_program_address(&[b"config"], &stockroom::ID)
                .0
                .to_string()
            && entry.data.len() == 8 + Config::INIT_SPACE - 49
        {
            let bump = entry.data.pop().unwrap();
            entry.data.push(ALL_PRODUCTS);
            entry.data.extend_from_slice(&[0; 32]);
            entry.data.extend_from_slice(&u64::MAX.to_le_bytes());
            entry.data.extend_from_slice(&0u64.to_le_bytes());
            entry.data.push(bump);
        }
        if entry.executable && entry.owner == solana_sdk::bpf_loader_upgradeable::ID {
            let data_key = Pubkey::new_from_array(entry.data[4..36].try_into().unwrap());
            let data = entries
                .iter()
                .find(|x| x["address"].as_str().unwrap() == data_key.to_string())
                .unwrap();
            entry.data = decode(data["data"].as_str().unwrap())[45..].to_vec();
            entry.owner = solana_sdk::bpf_loader::ID;
            entry.lamports = 100_000_000_000;
        }
        pt.add_account(a["address"].as_str().unwrap().parse().unwrap(), entry);
    }
    let mut ctx = pt.start_with_context().await;
    ctx.warp_to_slot(snap["slot"].as_u64().unwrap() + 1)
        .unwrap();
    ctx.set_sysvar(&Clock {
        unix_timestamp: snap["timestamp"].as_i64().unwrap(),
        slot: snap["slot"].as_u64().unwrap(),
        epoch: snap["epoch"].as_u64().unwrap(),
        ..Default::default()
    });
    let mut ix = vec![
        solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
    ];
    for item in snap["instructions"].as_array().unwrap() {
        ix.push(Instruction {
            program_id: item["programId"].as_str().unwrap().parse().unwrap(),
            accounts: item["keys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| AccountMeta {
                    pubkey: k["pubkey"].as_str().unwrap().parse().unwrap(),
                    is_signer: k["isSigner"].as_bool().unwrap(),
                    is_writable: k["isWritable"].as_bool().unwrap(),
                })
                .collect(),
            data: decode(item["data"].as_str().unwrap()),
        });
    }
    // A test lookup table changes message encoding only; all route account state and binaries are captured.
    let mut addresses = Vec::new();
    for i in &ix {
        for a in &i.accounts {
            if !a.is_signer && !addresses.contains(&a.pubkey) {
                addresses.push(a.pubkey);
            }
        }
    }
    let table_key = Pubkey::new_unique();
    let table = solana_sdk::address_lookup_table::state::AddressLookupTable {
        meta: Default::default(),
        addresses: std::borrow::Cow::Owned(addresses.clone()),
    }
    .serialize_for_tests()
    .unwrap();
    ctx.set_account(
        &table_key,
        &account(table, solana_sdk::address_lookup_table::program::ID).into(),
    );
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let message = v0::Message::try_compile(
        &owner.pubkey(),
        &ix,
        &[
            solana_sdk::address_lookup_table::AddressLookupTableAccount {
                key: table_key,
                addresses,
            },
        ],
        blockhash,
    )
    .unwrap();
    let tx = VersionedTransaction::try_new(VersionedMessage::V0(message), &[&owner]).unwrap();
    assert!(bincode::serialize(&tx).unwrap().len() <= 1232);
    let result = ctx
        .banks_client
        .process_transaction_with_metadata(tx)
        .await
        .unwrap();
    if result.result.is_err() {
        eprintln!("{:?} {:?}", result.result, result.metadata);
    }
    assert!(
        result.result.is_ok(),
        "Actual Jupiter CPI must settle without any Pyth accounts"
    );
    let key: Pubkey = snap["position"].as_str().unwrap().parse().unwrap();
    let info = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    let p = Position::try_deserialize(&mut &info.data[..]).unwrap();
    assert!(p.stock_units_received >= snap["minimum"].as_str().unwrap().parse::<u64>().unwrap());
    assert_eq!(
        p.stock_usdc_spent,
        snap["input"].as_str().unwrap().parse::<u64>().unwrap()
    );
    let destination = ctx
        .banks_client
        .get_account(snap["destination"].as_str().unwrap().parse().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        u64::from_le_bytes(destination.data[64..72].try_into().unwrap()),
        p.stock_units_received
    );
    match kind {
        "limit" => {
            assert_eq!(p.status, PositionStatus::Filled);
            assert_eq!(p.shares, 0);
            assert_eq!(p.principal_basis, 0);
        }
        "dca" => {
            assert_eq!(p.status, PositionStatus::Active);
            assert_eq!(p.steps_remaining, 1);
            assert!(p.shares > 0);
            assert!(p.principal_basis > 0);
        }
        _ => {
            assert_eq!(
                p.principal_basis,
                snap["principal"].as_str().unwrap().parse::<u64>().unwrap()
            );
            assert_eq!(
                p.shares,
                snap["shares"].as_str().unwrap().parse::<u64>().unwrap()
            );
            assert_eq!(p.claimable, 0);
        }
    }
}
#[tokio::test]
#[ignore = "requires snapshot-position-swap.ts; actual Jupiter and Kamino programs in local runtime"]
async fn deployed_position_limit_without_pyth() {
    run_position_snapshot("limit").await;
}
#[tokio::test]
#[ignore = "requires snapshot-position-swap.ts --dca"]
async fn deployed_position_dca_without_pyth() {
    run_position_snapshot("dca").await;
}
#[tokio::test]
#[ignore = "requires snapshot-position-swap.ts --stocks"]
async fn deployed_position_stocks_without_pyth() {
    run_position_snapshot("stocks").await;
}
