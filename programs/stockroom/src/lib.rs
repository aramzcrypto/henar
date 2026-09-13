#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
pub mod contexts;
pub mod kamino;
pub mod lucky;
pub mod oracle;
pub mod pack_swap;
pub mod packs;
pub mod positions;
pub mod position_swap;
pub mod state;
pub mod tokens;
use contexts::*;
use lucky::*;
use pack_swap::*;
use positions::PositionTerms;
use position_swap::*;
use state::*;
// Development-only placeholder. Deployment tooling replaces this with the generated program address.
declare_id!("7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E");

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigTerms {
    pub usdc_feed: [u8; 32],
    pub yield_share_bps: u16,
    pub pack_fee_bps: u16,
    pub trade_fee_bps: u16,
    pub max_slippage_bps: u16,
    pub max_confidence_bps: u16,
    pub oracle_max_age: u32,
    pub pack_timeout: u32,
}
#[program]
pub mod stockroom {
    use super::*;
    pub fn swap_position<'info>(
        ctx: Context<'_, '_, '_, 'info, SwapPosition<'info>>,
        terms: PositionSwapTerms,
        route: Vec<u8>,
    ) -> Result<()> {
        position_swap::swap(ctx, terms, route)
    }
    pub fn initialize(ctx: Context<Initialize>, terms: ConfigTerms) -> Result<()> {
        require!(
            terms.yield_share_bps <= 2000
                && terms.pack_fee_bps <= 500
                && terms.trade_fee_bps <= 100,
            StockroomError::Config
        );
        require!(
            terms.max_slippage_bps <= 100
                && (1..=100).contains(&terms.max_confidence_bps)
                && (1..=120).contains(&terms.oracle_max_age),
            StockroomError::Config
        );
        require!(
            (3600..=7 * 86400).contains(&terms.pack_timeout) && terms.usdc_feed != [0; 32],
            StockroomError::Config
        );
        let c = &mut ctx.accounts.config;
        **c = Config {
            admin: ctx.accounts.admin.key(),
            pending_admin: Pubkey::default(),
            treasury: ctx.accounts.treasury.key(),
            vault: ctx.accounts.vault.key(),
            shares_mint: ctx.accounts.shares_mint.key(),
            active_manifest: Pubkey::default(),
            usdc_feed: terms.usdc_feed,
            yield_share_bps: terms.yield_share_bps,
            pack_fee_bps: terms.pack_fee_bps,
            trade_fee_bps: terms.trade_fee_bps,
            max_slippage_bps: terms.max_slippage_bps,
            max_confidence_bps: terms.max_confidence_bps,
            oracle_max_age: terms.oracle_max_age,
            pack_timeout: terms.pack_timeout,
            paused: true,
            enabled_products: 0,
            pilot_owner: ctx.accounts.admin.key(),
            admission_limit: 100_000_000,
            admitted_usdc: 0,
            bump: ctx.bumps.config,
        };
        kamino::validate_vault(&ctx.accounts.vault.to_account_info(), c)?;
        Ok(())
    }
    pub fn set_paused(ctx: Context<Admin>, paused: bool) -> Result<()> {
        require!(
            paused || ctx.accounts.config.active_manifest != Pubkey::default(),
            StockroomError::Manifest
        );
        ctx.accounts.config.paused = paused;
        Ok(())
    }
    pub fn configure_access(
        ctx: Context<Admin>,
        products: u8,
        pilot_owner: Pubkey,
        admission_limit: u64,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(
            c.paused
                && products & !ALL_PRODUCTS == 0
                && admission_limit >= c.admitted_usdc
                && admission_limit > 0,
            StockroomError::Config
        );
        c.enabled_products = products;
        c.pilot_owner = pilot_owner;
        c.admission_limit = admission_limit;
        Ok(())
    }
    pub fn propose_admin(ctx: Context<Admin>, pending: Pubkey) -> Result<()> {
        require!(pending != Pubkey::default(), StockroomError::Config);
        ctx.accounts.config.pending_admin = pending;
        Ok(())
    }
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        ctx.accounts.config.admin = ctx.accounts.pending_admin.key();
        ctx.accounts.config.pending_admin = Pubkey::default();
        Ok(())
    }
    pub fn create_manifest(
        ctx: Context<CreateManifest>,
        version: u64,
        stocks: Vec<StockSpec>,
    ) -> Result<()> {
        validate_stocks(ctx.remaining_accounts, &stocks, &[])?;
        **ctx.accounts.manifest = Manifest {
            config: ctx.accounts.config.key(),
            sealed: false,
            version,
            stocks,
            created_at: Clock::get()?.unix_timestamp,
            bump: ctx.bumps.manifest,
        };
        Ok(())
    }
    pub fn append_manifest(ctx: Context<ActivateManifest>, stocks: Vec<StockSpec>) -> Result<()> {
        require!(!ctx.accounts.manifest.sealed, StockroomError::Manifest);
        validate_stocks(
            ctx.remaining_accounts,
            &stocks,
            &ctx.accounts.manifest.stocks,
        )?;
        ctx.accounts.manifest.stocks.extend(stocks);
        Ok(())
    }
    pub fn activate_manifest(ctx: Context<ActivateManifest>) -> Result<()> {
        require!(
            !ctx.accounts.manifest.stocks.is_empty(),
            StockroomError::Manifest
        );
        ctx.accounts.manifest.sealed = true;
        ctx.accounts.config.active_manifest = ctx.accounts.manifest.key();
        Ok(())
    }
    pub fn create_position<'info>(
        ctx: Context<'_, '_, '_, 'info, CreatePosition<'info>>,
        id: u64,
        amount: u64,
        min_shares: u64,
        terms: PositionTerms,
    ) -> Result<()> {
        positions::create(ctx, id, amount, min_shares, terms)
    }
    pub fn deposit_more<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
        amount: u64,
        min_shares: u64,
    ) -> Result<()> {
        positions::deposit_more(ctx, amount, min_shares)
    }
    pub fn set_preferences(
        ctx: Context<PositionOwner>,
        destination: Destination,
        auto_packs: bool,
        stock_index: u16,
    ) -> Result<()> {
        positions::preferences(ctx, destination, auto_packs, stock_index)
    }
    pub fn harvest<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
        withdraw_accounts: u16,
        min_redeemed: u64,
        min_shares: u64,
    ) -> Result<()> {
        positions::harvest(ctx, withdraw_accounts, min_redeemed, min_shares)
    }
    pub fn withdraw_principal<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
        amount: u64,
        withdraw_accounts: u16,
        min_redeemed: u64,
        min_shares: u64,
    ) -> Result<()> {
        positions::withdraw(
            ctx,
            amount,
            withdraw_accounts,
            min_redeemed,
            min_shares,
            false,
        )
    }
    pub fn cancel_order<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
        withdraw_accounts: u16,
        min_redeemed: u64,
    ) -> Result<()> {
        positions::withdraw(ctx, u64::MAX, withdraw_accounts, min_redeemed, 0, true)
    }
    pub fn claim_yield(ctx: Context<ManagePosition>, amount: u64) -> Result<()> {
        positions::claim(ctx, amount)
    }
    pub fn fill_order<'info>(
        ctx: Context<'_, '_, '_, 'info, SettlePosition<'info>>,
        delivered: u64,
        withdraw_accounts: u16,
        min_redeemed: u64,
        min_shares: u64,
        stock_transfer_accounts: u16,
    ) -> Result<()> {
        positions::fill(
            ctx,
            delivered,
            withdraw_accounts,
            min_redeemed,
            min_shares,
            stock_transfer_accounts,
        )
    }
    pub fn settle_yield<'info>(
        ctx: Context<'_, '_, '_, 'info, SettlePosition<'info>>,
        amount: u64,
        delivered: u64,
    ) -> Result<()> {
        positions::settle_yield(ctx, amount, delivered)
    }
    pub fn initialize_lucky(ctx: Context<InitializeLucky>) -> Result<()> {
        lucky::initialize(ctx)
    }
    pub fn configure_lucky(ctx: Context<AdminLucky>, enabled: bool, max_stake: u64) -> Result<()> {
        lucky::configure(ctx, enabled, max_stake)
    }
    pub fn withdraw_lucky_reserve(ctx: Context<AdminLucky>, amount: u64) -> Result<()> {
        lucky::withdraw(ctx, amount)
    }
    pub fn open_lucky(ctx: Context<OpenLucky>, index: u64, nonce: [u8; 32]) -> Result<()> {
        lucky::open(ctx, index, nonce)
    }
    pub fn resolve_lucky(ctx: Context<ResolveLucky>) -> Result<()> {
        lucky::resolve(ctx)
    }
    pub fn bank_lucky(ctx: Context<OwnerLucky>) -> Result<()> {
        lucky::bank(ctx)
    }
    pub fn roll_lucky(ctx: Context<RollLucky>, nonce: [u8; 32]) -> Result<()> {
        lucky::rollover(ctx, nonce)
    }
    pub fn refund_lucky(ctx: Context<OwnerLucky>) -> Result<()> {
        lucky::refund(ctx)
    }
    pub fn buy_batch(ctx: Context<BuyBatch>, id: u64, count: u64, slippage_bps: u16) -> Result<()> {
        packs::buy(ctx, id, count, slippage_bps)
    }
    pub fn yield_batch(ctx: Context<YieldBatch>, id: u64) -> Result<()> {
        packs::from_yield(ctx, id)
    }
    pub fn gift_batch(
        ctx: Context<GiftBatch>,
        id: u64,
        count: u64,
        recipient: Pubkey,
        message: String,
    ) -> Result<()> {
        packs::gift(ctx, id, count, recipient, message)
    }
    pub fn refund_batch(ctx: Context<RefundBatch>, count: u64) -> Result<()> {
        packs::refund_batch(ctx, count)
    }
    pub fn open_pack(ctx: Context<OpenPack>, index: u64, nonce: [u8; 32]) -> Result<()> {
        packs::open(ctx, index, nonce)
    }
    pub fn resolve_pack(ctx: Context<ResolvePack>) -> Result<()> {
        packs::resolve(ctx)
    }
    pub fn settle_pack<'info>(
        ctx: Context<'_, '_, '_, 'info, SettlePack<'info>>,
        delivered: u64,
    ) -> Result<()> {
        packs::settle(ctx, delivered)
    }
    pub fn configure_pack_execution(
        ctx: Context<ConfigurePackExecution>,
        authority: Pubkey,
        enabled: bool,
        max_budget: u64,
    ) -> Result<()> {
        pack_swap::configure(ctx, authority, enabled, max_budget)
    }
    pub fn swap_pack<'info>(
        ctx: Context<'_, '_, '_, 'info, SwapPack<'info>>,
        quoted_output: u64,
        minimum_output: u64,
        quoted_at: i64,
        route: Vec<u8>,
    ) -> Result<()> {
        pack_swap::swap(ctx, quoted_output, minimum_output, quoted_at, route)
    }
    pub fn refund_pack(ctx: Context<RefundPack>) -> Result<()> {
        packs::refund(ctx)
    }
}

fn validate_stocks(
    accounts: &[AccountInfo],
    stocks: &[StockSpec],
    existing: &[StockSpec],
) -> Result<()> {
    require!(
        !stocks.is_empty()
            && existing.len() + stocks.len() <= MAX_STOCKS
            && accounts.len() == stocks.len(),
        StockroomError::Manifest
    );
    for (i, spec) in stocks.iter().enumerate() {
        require!(
            spec.mint != USDC
                && spec.feed != [0; 32]
                && spec.ratio_numerator > 0
                && spec.ratio_denominator > 0
                && spec.ratio_numerator <= 1_000_000
                && spec.ratio_denominator <= 1_000_000
                && spec.decimals <= 12,
            StockroomError::Manifest
        );
        require!(
            !stocks[..i]
                .iter()
                .chain(existing.iter())
                .any(|s| s.mint == spec.mint),
            StockroomError::Manifest
        );
        require!(
            spec.token_program == anchor_spl::token::ID
                || spec.token_program == anchor_spl::token_2022::ID,
            StockroomError::Mint
        );
        let info = &accounts[i];
        require_keys_eq!(info.key(), spec.mint, StockroomError::Mint);
        require_keys_eq!(*info.owner, spec.token_program, StockroomError::Mint);
        let mint =
            anchor_spl::token_interface::Mint::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        require!(mint.decimals == spec.decimals, StockroomError::Mint);
    }
    Ok(())
}
