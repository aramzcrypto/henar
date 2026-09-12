//! Only fixed Kamino deposit/withdraw CPIs are permitted. No arbitrary instruction proxy.
use crate::state::*;
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use kvault_interface::{
    from_account_data,
    instructions::{
        deposit::{deposit as deposit_ix, DepositAccounts},
        withdraw::{withdraw, WithdrawAccounts},
    },
    state::VaultState,
};

pub fn validate_vault(account: &AccountInfo, config: &Config) -> Result<()> {
    require_keys_eq!(account.key(), config.vault, StockroomError::Vault);
    require_keys_eq!(*account.owner, KVAULT, StockroomError::Vault);
    let data = account.try_borrow_data()?;
    let v = from_account_data::<VaultState>(&data).map_err(|_| error!(StockroomError::Vault))?;
    require_keys_eq!(v.token_mint, USDC, StockroomError::Vault);
    require_keys_eq!(v.shares_mint, config.shares_mint, StockroomError::Vault);
    require_keys_eq!(
        v.token_program,
        anchor_spl::token::ID,
        StockroomError::Vault
    );
    require!(v.token_mint_decimals == 6, StockroomError::Vault);
    Ok(())
}
/// Read only immediately after a successful Kamino CPI, which refreshes all reserves and AUM.
pub fn refreshed_value(account: &AccountInfo, shares: u64) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let v = from_account_data::<VaultState>(&data).map_err(|_| error!(StockroomError::Vault))?;
    if shares == 0 {
        return Ok(0);
    }
    // Kamino Fraction is U68F60. Floor global AUM first; this is conservative by <1 base unit.
    let aum =
        u64::try_from(u128::from(v.prev_aum_sf) >> 60).map_err(|_| error!(StockroomError::Math))?;
    math(stockroom_math::mul_div(shares, aum, v.shares_issued, false))
}
pub fn redeposit_overhead(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let v = from_account_data::<VaultState>(&data).map_err(|_| error!(StockroomError::Vault))?;
    // Permissionless harvest must not incur curator-imposed withdrawal penalties.
    require!(
        v.withdrawal_penalty_bps == 0 && v.withdrawal_penalty_lamports == 0,
        StockroomError::PrincipalProtection
    );
    let count = v
        .vault_allocation_strategy
        .iter()
        .filter(|r| r.reserve != Pubkey::default())
        .count() as u64;
    let crank = math(stockroom_math::mul(count, v.crank_fund_fee_per_reserve))?;
    let aum =
        u64::try_from(u128::from(v.prev_aum_sf) >> 60).map_err(|_| error!(StockroomError::Math))?;
    let one_share = if v.shares_issued == 0 {
        1
    } else {
        math(stockroom_math::mul_div(aum, 1, v.shares_issued, true))?.max(1)
    };
    math(stockroom_math::add(
        crank,
        math(stockroom_math::add(one_share, 2))?,
    ))
}
fn metas(accounts: &[AccountInfo]) -> Vec<AccountMeta> {
    accounts
        .iter()
        .map(|a| AccountMeta {
            pubkey: a.key(),
            is_signer: false,
            is_writable: a.is_writable,
        })
        .collect()
}
fn check(
    accounts: &[AccountInfo],
    minimum: usize,
    config: &Config,
    authority: Pubkey,
    cash: Pubkey,
    shares: Pubkey,
    is_withdraw: bool,
) -> Result<()> {
    require!(
        accounts.len() >= minimum && accounts.len() <= 96,
        StockroomError::Vault
    );
    require_keys_eq!(accounts[0].key(), authority, StockroomError::Vault);
    validate_vault(&accounts[1], config)?;
    let (cash_i, shares_i, mint_i, shares_mint_i, program_i) = if is_withdraw {
        (5, 7, 6, 8, 13)
    } else {
        (6, 7, 3, 5, 12)
    };
    require_keys_eq!(accounts[cash_i].key(), cash, StockroomError::Vault);
    require_keys_eq!(accounts[shares_i].key(), shares, StockroomError::Vault);
    require_keys_eq!(accounts[mint_i].key(), USDC, StockroomError::Vault);
    require_keys_eq!(
        accounts[shares_mint_i].key(),
        config.shares_mint,
        StockroomError::Vault
    );
    require_keys_eq!(accounts[program_i].key(), KVAULT, StockroomError::Vault);
    Ok(())
}
fn execute<'info>(ix: Instruction, accounts: &[AccountInfo<'info>], seeds: &[&[u8]]) -> Result<()> {
    invoke_signed(&ix, accounts, &[seeds]).map_err(Into::into)
}
pub fn deposit<'info>(
    accounts: &[AccountInfo<'info>],
    config: &Config,
    authority: Pubkey,
    cash: Pubkey,
    shares: Pubkey,
    amount: u64,
    _min_shares: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    check(accounts, 13, config, authority, cash, shares, false)?;
    let k = |i: usize| accounts[i].key();
    let ix = deposit_ix(
        DepositAccounts {
            user: k(0),
            vault_state: k(1),
            token_vault: k(2),
            token_mint: k(3),
            base_vault_authority: k(4),
            shares_mint: k(5),
            user_token_ata: k(6),
            user_shares_ata: k(7),
            klend_program: k(8),
            token_program: k(9),
            shares_token_program: k(10),
        },
        amount,
        metas(&accounts[13..]),
    );
    execute(ix, accounts, seeds)
}
fn redeem_one<'info>(
    accounts: &[AccountInfo<'info>],
    config: &Config,
    authority: Pubkey,
    cash: Pubkey,
    shares: Pubkey,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    check(accounts, 25, config, authority, cash, shares, true)?;
    require_keys_eq!(accounts[14].key(), config.vault, StockroomError::Vault);
    let k = |i: usize| accounts[i].key();
    let ix = withdraw(
        WithdrawAccounts {
            user: k(0),
            vault_state: k(1),
            global_config: k(2),
            token_vault: k(3),
            base_vault_authority: k(4),
            user_token_ata: k(5),
            token_mint: k(6),
            user_shares_ata: k(7),
            shares_mint: k(8),
            token_program: k(9),
            shares_token_program: k(10),
            klend_program: k(11),
            invested_vault_state: k(14),
            reserve: k(15),
            ctoken_vault: k(16),
            lending_market: k(17),
            lending_market_authority: k(18),
            reserve_liquidity_supply: k(19),
            reserve_collateral_mint: k(20),
            reserve_collateral_token_program: k(21),
            instruction_sysvar_account: k(22),
        },
        amount,
        metas(&accounts[25..]),
    );
    execute(ix, accounts, seeds)
}

/// Redeem tracked shares across canonical reserve groups, measuring every burn.
/// All groups remain in one atomic instruction; incomplete redemption rolls back.
pub fn redeem<'info>(
    accounts: &[AccountInfo<'info>],
    config: &Config,
    authority: Pubkey,
    cash: Pubkey,
    shares: Pubkey,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    require!(accounts.len() >= 25, StockroomError::Vault);
    validate_vault(&accounts[1], config)?;
    let reserves = {
        let data = accounts[1].try_borrow_data()?;
        let v =
            from_account_data::<VaultState>(&data).map_err(|_| error!(StockroomError::Vault))?;
        v.vault_allocation_strategy
            .iter()
            .filter(|r| r.reserve != Pubkey::default())
            .count()
    };
    let group = 25 + 2 * reserves;
    require!(
        accounts.len() % group == 0 && accounts.len() / group <= 32,
        StockroomError::Vault
    );
    let mut remaining = amount;
    for chunk in accounts.chunks_exact(group) {
        if remaining == 0 {
            break;
        }
        let balance = || -> Result<u64> {
            let data = chunk[7].try_borrow_data()?;
            Ok(anchor_spl::token::TokenAccount::try_deserialize(&mut data.as_ref())?.amount)
        };
        let before = balance()?;
        redeem_one(chunk, config, authority, cash, shares, remaining, seeds)?;
        let burned = math(stockroom_math::sub(before, balance()?))?;
        require!(burned <= remaining, StockroomError::Vault);
        remaining = math(stockroom_math::sub(remaining, burned))?;
    }
    require!(remaining == 0, StockroomError::Vault);
    Ok(())
}
