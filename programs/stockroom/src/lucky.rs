//! Opt-in Lucky opening. Fixed 95% theoretical RTP, max two rolls.
//! Maximum rewards are physically escrowed before fresh ORAO requests.
use crate::{contexts::*, packs, state::*, tokens};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};
use orao_solana_vrf::{
    program::OraoVrf,
    state::{NetworkState, RandomnessAccountData},
    CONFIG_ACCOUNT_SEED, RANDOMNESS_ACCOUNT_SEED,
};
use solana_sha256_hasher::hashv;

#[derive(Accounts)]
pub struct InitializeLucky<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
    #[account(init,payer=admin,space=8+LuckyPool::INIT_SPACE,seeds=[b"lucky-pool"],bump)]
    pub pool: Account<'info, LuckyPool>,
    #[account(address=USDC)]
    pub usdc: Account<'info, Mint>,
    #[account(init,payer=admin,associated_token::mint=usdc,associated_token::authority=pool)]
    pub pool_cash: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct AdminLucky<'info> {
    pub admin: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
    #[account(mut,seeds=[b"lucky-pool"],bump=pool.bump,has_one=config)]
    pub pool: Account<'info, LuckyPool>,
    #[account(address=USDC)]
    pub usdc: Account<'info, Mint>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=pool)]
    pub pool_cash: Account<'info, TokenAccount>,
    #[account(mut,address=config.treasury,token::mint=usdc)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
// OpenPack consumes the instruction index; do not deserialize it twice here.
pub struct OpenLucky<'info> {
    pub base: OpenPack<'info>,
    #[account(seeds=[b"lucky-pool"],bump=pool.bump,constraint=pool.config==base.config.key())]
    pub pool: Account<'info, LuckyPool>,
    #[account(mut,associated_token::mint=base.usdc,associated_token::authority=pool)]
    pub pool_cash: Account<'info, TokenAccount>,
    #[account(mut,address=base.config.treasury,token::mint=base.usdc)]
    pub treasury: Account<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct LuckyCash<'info> {
    #[account(mut,seeds=[b"pack",pack.batch.as_ref(),&pack.index.to_le_bytes()],bump=pack.bump,constraint=pack.lucky @ StockroomError::State)]
    pub pack: Box<Account<'info, Pack>>,
    #[account(seeds=[b"lucky-pool"],bump=pool.bump,constraint=pool.config==pack.config)]
    pub pool: Account<'info, LuckyPool>,
    #[account(address=USDC)]
    pub usdc: Account<'info, Mint>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=pool)]
    pub pool_cash: Account<'info, TokenAccount>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=pack)]
    pub pack_cash: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct ResolveLucky<'info> {
    pub cash: LuckyCash<'info>,
    #[account(address=cash.pack.manifest)]
    pub manifest: Box<Account<'info, Manifest>>,
    /// CHECK: Full ORAO validation in handler.
    pub randomness: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct OwnerLucky<'info> {
    pub cash: LuckyCash<'info>,
    #[account(mut,address=cash.pack.owner)]
    pub owner: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,address=cash.pack.config)]
    pub config: Account<'info, Config>,
    #[account(mut,token::mint=cash.usdc,token::authority=owner)]
    pub owner_cash: Account<'info, TokenAccount>,
    /// CHECK: Canonical current request required for timeout refunds; fresh request for rollover.
    #[account(mut)]
    pub randomness: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct RollLucky<'info> {
    pub base: OwnerLucky<'info>,
    #[account(mut,seeds=[CONFIG_ACCOUNT_SEED],bump,seeds::program=orao_solana_vrf::ID)]
    pub network: Account<'info, NetworkState>,
    /// CHECK: ORAO checks treasury.
    #[account(mut)]
    pub orao_treasury: UncheckedAccount<'info>,
    pub orao_program: Program<'info, OraoVrf>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<InitializeLucky>) -> Result<()> {
    *ctx.accounts.pool = LuckyPool {
        config: ctx.accounts.config.key(),
        enabled: false,
        max_stake: 20_000_000,
        bump: ctx.bumps.pool,
    };
    Ok(())
}
pub fn configure(ctx: Context<AdminLucky>, enabled: bool, max_stake: u64) -> Result<()> {
    require!(
        (PACK_USDC..=1_000_000_000).contains(&max_stake),
        StockroomError::Config
    );
    ctx.accounts.pool.enabled = enabled;
    ctx.accounts.pool.max_stake = max_stake;
    Ok(())
}
pub fn withdraw(ctx: Context<AdminLucky>, amount: u64) -> Result<()> {
    pool_pay(
        &ctx.accounts.pool,
        &ctx.accounts.pool_cash,
        &ctx.accounts.treasury,
        &ctx.accounts.token_program,
        amount,
    )
}
fn pool_pay<'info>(
    pool: &Account<'info, LuckyPool>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    token: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let bump = [pool.bump];
    tokens::pay(
        token.to_account_info(),
        from.to_account_info(),
        to.to_account_info(),
        pool.to_account_info(),
        amount,
        Some(&[b"lucky-pool", &bump]),
    )
}
fn pack_pay<'info>(
    cash: &LuckyCash<'info>,
    to: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    let p = &cash.pack;
    let index = p.index.to_le_bytes();
    let bump = [p.bump];
    tokens::pay(
        cash.token_program.to_account_info(),
        cash.pack_cash.to_account_info(),
        to.to_account_info(),
        p.to_account_info(),
        amount,
        Some(&[b"pack", p.batch.as_ref(), &index, &bump]),
    )
}
pub fn open(ctx: Context<OpenLucky>, index: u64, nonce: [u8; 32]) -> Result<()> {
    ctx.accounts
        .base
        .config
        .check_product(PRODUCT_PACKS | PRODUCT_LUCKY)?;
    let a = &mut ctx.accounts.base;
    // Earned packs preserve their full yield allocation; no automatic gambling of yield.
    require!(
        a.batch.source == PackSource::Purchased,
        StockroomError::State
    );
    let stake = math(stockroom_math::sub(PACK_USDC, a.batch.unit_fee))?;
    require!(
        ctx.accounts.pool.enabled && stake <= ctx.accounts.pool.max_stake,
        StockroomError::Config
    );
    require!(
        ctx.accounts.pool_cash.amount >= stake,
        StockroomError::Balance
    );
    packs::open_accounts(a, index, nonce, ctx.bumps.base.pack)?;
    pool_pay(
        &ctx.accounts.pool,
        &ctx.accounts.pool_cash,
        &a.pack_cash,
        &a.token_program,
        stake,
    )?;
    let p = &mut a.pack;
    let bid = p.index.to_le_bytes();
    let bump = [p.bump];
    tokens::pay(
        a.token_program.to_account_info(),
        a.pack_cash.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
        p.to_account_info(),
        p.unit_fee,
        Some(&[b"pack", p.batch.as_ref(), &bid, &bump]),
    )?;
    p.unit_fee = 0; // Initial disclosed fee paid exactly once, never on rollovers/banking.
    p.lucky = true;
    p.round = 1;
    p.stake = stake;
    p.budget = stake;
    emit_activity(p.owner, p.key(), 20, stake, 1)
}
fn random_data(info: &AccountInfo, p: &Pack) -> Result<RandomnessAccountData> {
    require_keys_eq!(*info.owner, orao_solana_vrf::ID, StockroomError::Randomness);
    require_keys_eq!(
        info.key(),
        Pubkey::find_program_address(&[RANDOMNESS_ACCOUNT_SEED, &p.force], &orao_solana_vrf::ID).0,
        StockroomError::Randomness
    );
    let r = RandomnessAccountData::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(
        r.seed() == &p.force && r.client() == Some(&p.owner),
        StockroomError::Randomness
    );
    Ok(r)
}
pub fn resolve(ctx: Context<ResolveLucky>) -> Result<()> {
    let cash = &mut ctx.accounts.cash;
    require!(
        cash.pack.status == PackStatus::Pending,
        StockroomError::State
    );
    // Fulfilled outcomes MUST resolve even after timeout: no cherry-picked refunds.
    let r = random_data(&ctx.accounts.randomness.to_account_info(), &cash.pack)?;
    let random = r
        .fulfilled_randomness()
        .ok_or(StockroomError::RandomnessPending)?;
    let bucket = packs::sample_domain(random, 100, b"kani-lucky-payout-v1")? as u8;
    let reward = math(stockroom_math::lucky_payout(cash.pack.stake, bucket))?;
    let maximum = math(stockroom_math::mul(cash.pack.stake, 2))?;
    require!(cash.pack_cash.amount >= maximum, StockroomError::Balance);
    let eligible: Vec<usize> = ctx
        .accounts
        .manifest
        .stocks
        .iter()
        .enumerate()
        .filter_map(|(i, s)| s.pack_eligible.then_some(i))
        .collect();
    if cash.pack.round == 1 {
        cash.pack.stock_index = eligible[packs::sample(random, eligible.len())?] as u16;
    }
    pack_pay(
        cash,
        &cash.pool_cash,
        math(stockroom_math::sub(maximum, reward))?,
    )?;
    cash.pack.budget = reward;
    cash.pack.status = PackStatus::LuckyReady;
    emit_activity(
        cash.pack.owner,
        cash.pack.key(),
        21,
        reward,
        cash.pack.round as u64,
    )
}
pub fn bank(ctx: Context<OwnerLucky>) -> Result<()> {
    let p = &mut ctx.accounts.cash.pack;
    require!(p.status == PackStatus::LuckyReady, StockroomError::State);
    p.status = PackStatus::Selected;
    p.expires_at = Clock::get()?
        .unix_timestamp
        .checked_add(ctx.accounts.config.pack_timeout as i64)
        .ok_or(StockroomError::Math)?;
    emit_activity(p.owner, p.key(), 22, p.budget, p.round as u64)
}
pub fn rollover(ctx: Context<RollLucky>, nonce: [u8; 32]) -> Result<()> {
    ctx.accounts
        .base
        .config
        .check_product(PRODUCT_PACKS | PRODUCT_LUCKY)?;
    ctx.accounts
        .base
        .config
        .check_pilot(ctx.accounts.base.owner.key())?;
    let b = &mut ctx.accounts.base;
    let cash = &mut b.cash;
    require!(
        !b.config.paused && cash.pool.enabled,
        StockroomError::Paused
    );
    require!(
        cash.pack.status == PackStatus::LuckyReady && cash.pack.round == 1,
        StockroomError::State
    );
    let stake = cash.pack.budget;
    require!(
        stake > 0 && stake <= cash.pool.max_stake && cash.pool_cash.amount >= stake,
        StockroomError::Balance
    );
    let force = hashv(&[
        b"kani-lucky-roll-v1",
        crate::ID.as_ref(),
        cash.pack.key().as_ref(),
        &[2],
        &nonce,
    ])
    .to_bytes();
    require_keys_eq!(
        b.randomness.key(),
        Pubkey::find_program_address(&[RANDOMNESS_ACCOUNT_SEED, &force], &orao_solana_vrf::ID).0,
        StockroomError::Randomness
    );
    require!(b.randomness.data_is_empty(), StockroomError::Randomness);
    pool_pay(
        &cash.pool,
        &cash.pool_cash,
        &cash.pack_cash,
        &cash.token_program,
        stake,
    )?;
    orao_solana_vrf::cpi::request_v2(
        CpiContext::new(
            ctx.accounts.orao_program.to_account_info(),
            orao_solana_vrf::cpi::accounts::RequestV2 {
                payer: b.owner.to_account_info(),
                network_state: ctx.accounts.network.to_account_info(),
                treasury: ctx.accounts.orao_treasury.to_account_info(),
                request: b.randomness.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ),
        force,
    )?;
    cash.pack.force = force;
    cash.pack.stake = stake;
    cash.pack.round = 2;
    cash.pack.status = PackStatus::Pending;
    cash.pack.expires_at = Clock::get()?
        .unix_timestamp
        .checked_add(b.config.pack_timeout as i64)
        .ok_or(StockroomError::Math)?;
    emit_activity(cash.pack.owner, cash.pack.key(), 23, stake, 2)
}
pub fn refund(ctx: Context<OwnerLucky>) -> Result<()> {
    let cash = &mut ctx.accounts.cash;
    require!(
        Clock::get()?.unix_timestamp >= cash.pack.expires_at,
        StockroomError::NotExpired
    );
    let amount = if cash.pack.status == PackStatus::Pending {
        let r = random_data(&ctx.accounts.randomness.to_account_info(), &cash.pack)?;
        require!(r.fulfilled_randomness().is_none(), StockroomError::State);
        // Undo only an unfulfilled roll, not its previously resolved outcome.
        pack_pay(cash, &cash.pool_cash, cash.pack.stake)?;
        cash.pack.stake
    } else {
        require!(
            cash.pack.status == PackStatus::Selected,
            StockroomError::State
        );
        cash.pack.budget
    };
    pack_pay(cash, &ctx.accounts.owner_cash, amount)?;
    cash.pack.status = PackStatus::Refunded;
    cash.pack.settled_at = Clock::get()?.unix_timestamp;
    emit_activity(cash.pack.owner, cash.pack.key(), 24, amount, 0)
}
