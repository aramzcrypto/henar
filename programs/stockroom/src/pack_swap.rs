//! Oracle-free pack execution. The configured quote authority is trusted for price quality;
//! custody, mint, net delivery, budget, freshness and one-time settlement are enforced here.
use crate::{state::*, tokens};
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    token_interface::{Mint as StockMint, TokenAccount as StockAccount, TokenInterface},
};

pub const JUPITER: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
#[account]
#[derive(InitSpace)]
pub struct PackExecution {
    pub authority: Pubkey,
    pub enabled: bool,
    pub max_budget: u64,
    pub bump: u8,
}
#[derive(Accounts)]
pub struct ConfigurePackExecution<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed,payer=admin,space=8+PackExecution::INIT_SPACE,seeds=[b"pack-execution"],bump)]
    pub execution: Account<'info, PackExecution>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SwapPack<'info> {
    #[account(address=execution.authority @ StockroomError::Unauthorized)]
    pub quote_authority: Signer<'info>,
    #[account(seeds=[b"pack-execution"],bump=execution.bump)]
    pub execution: Account<'info, PackExecution>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut,has_one=config,seeds=[b"pack",pack.batch.as_ref(),&pack.index.to_le_bytes()],bump=pack.bump)]
    pub pack: Box<Account<'info, Pack>>,
    #[account(address=pack.manifest,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=pack)]
    pub pack_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,address=config.treasury,token::mint=usdc)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub stock_mint: Box<InterfaceAccount<'info, StockMint>>,
    #[account(mut,token::mint=stock_mint,token::token_program=stock_program,constraint=owner_stock.owner==pack.owner @ StockroomError::Unauthorized)]
    pub owner_stock: Box<InterfaceAccount<'info, StockAccount>>,
    pub stock_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Fixed executable Jupiter router, never a caller-selected program.
    #[account(address=JUPITER,executable)]
    pub jupiter: UncheckedAccount<'info>,
}
pub fn configure(
    ctx: Context<ConfigurePackExecution>,
    authority: Pubkey,
    enabled: bool,
    max_budget: u64,
) -> Result<()> {
    require!(
        authority != Pubkey::default() && max_budget > 0 && max_budget <= 1_000_000_000,
        StockroomError::Config
    );
    *ctx.accounts.execution = PackExecution {
        authority,
        enabled,
        max_budget,
        bump: ctx.bumps.execution,
    };
    Ok(())
}
pub fn swap<'info>(
    ctx: Context<'_, '_, '_, 'info, SwapPack<'info>>,
    quoted_output: u64,
    minimum_output: u64,
    quoted_at: i64,
    route: Vec<u8>,
) -> Result<()> {
    let a = ctx.accounts;
    a.config.check_product(PRODUCT_PACKS)?;
    let p = &mut a.pack;
    let now = Clock::get()?.unix_timestamp;
    require!(
        a.execution.enabled && !a.config.paused,
        StockroomError::Paused
    );
    require!(p.status == PackStatus::Selected, StockroomError::State);
    require!(
        now < p.expires_at && quoted_at <= now && now - quoted_at <= 30,
        StockroomError::Expired
    );
    require!(
        p.budget > 0 && p.budget <= a.execution.max_budget,
        StockroomError::Config
    );
    require!(
        p.slippage_bps <= 100
            && quoted_output > 0
            && minimum_output > 0
            && minimum_output <= quoted_output,
        StockroomError::Delivery
    );
    let floor = (quoted_output as u128 * (10000 - p.slippage_bps) as u128 + 9999) / 10000;
    require!(minimum_output as u128 >= floor, StockroomError::Delivery);
    require!(
        !route.is_empty() && route.len() <= 1024 && !ctx.remaining_accounts.is_empty(),
        StockroomError::Config
    );
    // Only exact-input V2 route instructions; never forward arbitrary Jupiter opcodes.
    require!(
        route.starts_with(&[187, 100, 250, 204, 49, 196, 175, 20])
            || route.starts_with(&[209, 152, 83, 147, 124, 254, 216, 233]),
        StockroomError::Config
    );
    let spec = a
        .manifest
        .stocks
        .get(p.stock_index as usize)
        .ok_or(StockroomError::Manifest)?;
    tokens::validate_stock(spec, &a.stock_mint, a.stock_program.key())?;
    let before_cash = a.pack_cash.amount;
    let before_stock = a.owner_stock.amount;
    require!(
        before_cash >= math(stockroom_math::add(p.budget, p.unit_fee))?,
        StockroomError::Delivery
    );
    let batch = p.batch;
    let index = p.index.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"pack".as_ref(),
        batch.as_ref(),
        index.as_ref(),
        bump.as_ref(),
    ];
    // Only the pack PDA signs the inner call. Never forward the quote service's signer privilege.
    let accounts = ctx
        .remaining_accounts
        .iter()
        .map(|info| AccountMeta {
            pubkey: info.key(),
            is_writable: info.is_writable,
            is_signer: info.key() == p.key(),
        })
        .collect();
    invoke_signed(
        &Instruction {
            program_id: JUPITER,
            accounts,
            data: route,
        },
        ctx.remaining_accounts,
        &[seeds],
    )?;
    a.pack_cash.reload()?;
    a.owner_stock.reload()?;
    let spent = math(stockroom_math::sub(before_cash, a.pack_cash.amount))?;
    let received = math(stockroom_math::sub(a.owner_stock.amount, before_stock))?;
    require!(
        spent == p.budget && received >= minimum_output,
        StockroomError::Delivery
    );
    require_keys_eq!(a.pack_cash.owner, p.key(), StockroomError::Unauthorized);
    require_keys_eq!(a.pack_cash.mint, USDC, StockroomError::Mint);
    require_keys_eq!(a.owner_stock.mint, spec.mint, StockroomError::Mint);
    require!(
        a.pack_cash.delegate.is_none() && a.pack_cash.close_authority.is_none(),
        StockroomError::Unauthorized
    );
    require_keys_eq!(a.owner_stock.owner, p.owner, StockroomError::Unauthorized);
    tokens::pay(
        a.token_program.to_account_info(),
        a.pack_cash.to_account_info(),
        a.treasury.to_account_info(),
        p.to_account_info(),
        p.unit_fee,
        Some(seeds),
    )?;
    p.status = PackStatus::Settled;
    p.units_received = received;
    p.ui_multiplier_bits = tokens::ui_multiplier_bits(&a.stock_mint.to_account_info())?;
    p.stock_value = spent;
    p.settled_at = now;
    emit_activity(p.owner, p.key(), 16, spent, received)
}
