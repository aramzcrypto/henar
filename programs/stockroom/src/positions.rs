use crate::{contexts::*, kamino, oracle, state::*, tokens};
use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PositionTerms {
    pub kind: PositionKind,
    pub destination: Destination,
    pub auto_packs: bool,
    pub stock_index: u16,
    pub target_price: u64,
    pub steps: u16,
    pub interval_seconds: u32,
    pub expires_at: i64,
    pub slippage_bps: u16,
}

pub fn create<'info>(
    ctx: Context<'_, '_, '_, 'info, CreatePosition<'info>>,
    id: u64,
    amount: u64,
    min_shares: u64,
    terms: PositionTerms,
) -> Result<()> {
    ctx.accounts.config.admit(
        ctx.accounts.owner.key(),
        amount,
        position_products(terms.kind, terms.destination),
    )?;
    require!(amount > 0 && min_shares > 0, StockroomError::Balance);
    require!(
        terms.slippage_bps <= ctx.accounts.config.max_slippage_bps,
        StockroomError::Config
    );
    let now = Clock::get()?.unix_timestamp;
    if terms.kind != PositionKind::Earn || terms.destination == Destination::Stocks {
        require!(
            (terms.stock_index as usize) < ctx.accounts.manifest.stocks.len(),
            StockroomError::Manifest
        );
    }
    if terms.kind != PositionKind::Earn {
        require!(
            terms.expires_at > now && terms.expires_at <= now + 366 * 86400,
            StockroomError::Expired
        );
    }
    if terms.kind == PositionKind::Limit {
        require!(terms.target_price > 0, StockroomError::Config);
    }
    if terms.kind == PositionKind::Dca {
        require!(
            (2..=365).contains(&terms.steps)
                && (3600..=31 * 86400).contains(&terms.interval_seconds),
            StockroomError::Config
        );
    }
    let owner = ctx.accounts.owner.key();
    let id_bytes = id.to_le_bytes();
    let bump = [ctx.bumps.position];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id_bytes.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.owner_cash.to_account_info(),
        ctx.accounts.cash.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        amount,
        None,
    )?;
    ctx.accounts.cash.reload()?;
    let cash_before = ctx.accounts.cash.amount;
    let shares_before = ctx.accounts.shares.amount;
    kamino::deposit(
        ctx.remaining_accounts,
        &ctx.accounts.config,
        ctx.accounts.position.key(),
        ctx.accounts.cash.key(),
        ctx.accounts.shares.key(),
        amount,
        min_shares,
        seeds,
    )?;
    ctx.accounts.cash.reload()?;
    ctx.accounts.shares.reload()?;
    let spent = math(stockroom_math::sub(cash_before, ctx.accounts.cash.amount))?;
    let shares = math(stockroom_math::sub(
        ctx.accounts.shares.amount,
        shares_before,
    ))?;
    require!(
        spent > 0 && spent <= amount && shares >= min_shares,
        StockroomError::Vault
    );
    let change = math(stockroom_math::sub(amount, spent))?;
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.cash.to_account_info(),
        ctx.accounts.owner_cash.to_account_info(),
        ctx.accounts.position.to_account_info(),
        change,
        Some(seeds),
    )?;
    let p = &mut ctx.accounts.position;
    ***p = Position {
        owner,
        config: ctx.accounts.config.key(),
        manifest: ctx.accounts.manifest.key(),
        id,
        principal_basis: spent,
        shares,
        invested_fee_basis: 0,
        pending_fees: 0,
        claimable: 0,
        gross_yield: 0,
        yield_fees: 0,
        allocated_yield: 0,
        stock_units_received: 0,
        stock_usdc_spent: 0,
        stock_index: terms.stock_index,
        yield_share_bps: ctx.accounts.config.yield_share_bps,
        trade_fee_bps: ctx.accounts.config.trade_fee_bps,
        fee_carry: 0,
        slippage_bps: terms.slippage_bps,
        kind: terms.kind,
        destination: terms.destination,
        auto_packs: terms.auto_packs,
        status: PositionStatus::Active,
        target_price: terms.target_price,
        steps_remaining: if terms.kind == PositionKind::Dca {
            terms.steps
        } else {
            1
        },
        interval_seconds: terms.interval_seconds,
        next_fill_at: if terms.kind == PositionKind::Dca {
            now + terms.interval_seconds as i64
        } else {
            now
        },
        expires_at: if terms.kind == PositionKind::Earn {
            i64::MAX
        } else {
            terms.expires_at
        },
        created_at: now,
        updated_at: now,
        bump: ctx.bumps.position,
    };
    emit_activity(owner, p.key(), 1, spent, shares)
}
pub fn preferences(
    ctx: Context<PositionOwner>,
    destination: Destination,
    auto_packs: bool,
    stock_index: u16,
) -> Result<()> {
    let p = &mut ctx.accounts.position;
    ctx.accounts
        .config
        .check_product(position_products(p.kind, destination))?;
    ctx.accounts.config.check_pilot(p.owner)?;
    require!(
        p.kind == PositionKind::Earn && p.status == PositionStatus::Active,
        StockroomError::State
    );
    if destination == Destination::Stocks {
        require!(
            (stock_index as usize) < ctx.accounts.manifest.stocks.len(),
            StockroomError::Manifest
        );
    }
    p.destination = destination;
    p.auto_packs = auto_packs;
    p.stock_index = stock_index;
    emit_activity(p.owner, p.key(), 2, 0, 0)
}
pub fn deposit_more<'info>(
    ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
    amount: u64,
    min_shares: u64,
) -> Result<()> {
    let a = ctx.accounts;
    let p = &mut a.position;
    require_keys_eq!(a.actor.key(), p.owner, StockroomError::Unauthorized);
    require!(
        !a.config.paused && p.kind == PositionKind::Earn && p.status == PositionStatus::Active,
        StockroomError::State
    );
    require!(amount > 0 && min_shares > 0, StockroomError::Balance);
    a.config
        .admit(p.owner, amount, position_products(p.kind, p.destination))?;
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.token_program.to_account_info(),
        a.owner_cash.to_account_info(),
        a.cash.to_account_info(),
        a.actor.to_account_info(),
        amount,
        None,
    )?;
    a.cash.reload()?;
    let before = a.cash.amount;
    let before_shares = a.shares.amount;
    kamino::deposit(
        ctx.remaining_accounts,
        &a.config,
        p.key(),
        a.cash.key(),
        a.shares.key(),
        amount,
        min_shares,
        seeds,
    )?;
    a.cash.reload()?;
    a.shares.reload()?;
    let spent = math(stockroom_math::sub(before, a.cash.amount))?;
    let minted = math(stockroom_math::sub(a.shares.amount, before_shares))?;
    require!(
        spent > 0 && spent <= amount && minted >= min_shares,
        StockroomError::Vault
    );
    p.principal_basis = math(stockroom_math::add(p.principal_basis, spent))?;
    p.shares = math(stockroom_math::add(p.shares, minted))?;
    tokens::pay(
        a.token_program.to_account_info(),
        a.cash.to_account_info(),
        a.owner_cash.to_account_info(),
        p.to_account_info(),
        math(stockroom_math::sub(amount, spent))?,
        Some(seeds),
    )?;
    emit_activity(owner, p.key(), 1, spent, minted)
}
/// Realize only measured USDC received for tracked shares, excluding unsolicited cash/share donations.
pub(crate) fn redeem_all<'info>(
    a: &mut ManagePosition<'info>,
    accounts: &[AccountInfo<'info>],
    min_redeemed: u64,
) -> Result<u64> {
    let p = &mut a.position;
    if p.shares == 0 {
        require!(
            p.principal_basis == 0 && p.invested_fee_basis == 0,
            StockroomError::State
        );
        return Ok(0);
    }
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    let before = a.cash.amount;
    let before_shares = a.shares.amount;
    let tracked = p.shares;
    kamino::redeem(
        accounts,
        &a.config,
        p.key(),
        a.cash.key(),
        a.shares.key(),
        tracked,
        seeds,
    )?;
    a.cash.reload()?;
    a.shares.reload()?;
    require!(
        math(stockroom_math::sub(before_shares, a.shares.amount))? == tracked,
        StockroomError::Vault
    );
    let redeemed = math(stockroom_math::sub(a.cash.amount, before))?;
    require!(redeemed >= min_redeemed, StockroomError::Balance);
    let basis = math(stockroom_math::add(p.principal_basis, p.invested_fee_basis))?;
    let realized = math(stockroom_math::realize(
        redeemed,
        basis,
        p.yield_share_bps,
        p.fee_carry,
    ))?;
    let principal_value = redeemed.min(p.principal_basis);
    let recovered_invested_fee = redeemed.min(basis).saturating_sub(principal_value);
    p.claimable = math(stockroom_math::add(p.claimable, realized.net))?;
    p.pending_fees = math(stockroom_math::add(
        p.pending_fees,
        math(stockroom_math::add(realized.fee, recovered_invested_fee))?,
    ))?;
    p.gross_yield = math(stockroom_math::add(p.gross_yield, realized.gross))?;
    p.yield_fees = math(stockroom_math::add(p.yield_fees, realized.fee))?;
    p.fee_carry = realized.fee_carry;
    p.shares = 0;
    p.invested_fee_basis = 0;
    Ok(principal_value)
}
pub(crate) fn reinvest<'info>(
    a: &mut ManagePosition<'info>,
    accounts: &[AccountInfo<'info>],
    principal: u64,
    min_shares: u64,
    protect: bool,
) -> Result<()> {
    if principal == 0 {
        return Ok(());
    }
    a.cash.reload()?;
    a.shares.reload()?;
    let overhead = kamino::redeposit_overhead(accounts.get(1).ok_or(StockroomError::Vault)?)?;
    let p = &mut a.position;
    let reserve = if protect {
        require!(
            p.pending_fees >= overhead,
            StockroomError::PrincipalProtection
        );
        overhead
    } else {
        overhead.min(p.pending_fees)
    };
    let max_deposit = math(stockroom_math::add(principal, reserve))?;
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    let before = a.cash.amount;
    let before_shares = a.shares.amount;
    kamino::deposit(
        accounts,
        &a.config,
        p.key(),
        a.cash.key(),
        a.shares.key(),
        max_deposit,
        min_shares.max(1),
        seeds,
    )?;
    a.cash.reload()?;
    a.shares.reload()?;
    let spent = math(stockroom_math::sub(before, a.cash.amount))?;
    require!(
        spent >= principal && spent <= max_deposit,
        StockroomError::Vault
    );
    p.shares = math(stockroom_math::sub(a.shares.amount, before_shares))?;
    require!(p.shares >= min_shares.max(1), StockroomError::Vault);
    p.invested_fee_basis = math(stockroom_math::sub(spent, principal))?;
    p.pending_fees = math(stockroom_math::sub(p.pending_fees, p.invested_fee_basis))?;
    if protect {
        require!(
            kamino::refreshed_value(&accounts[1], p.shares)? >= principal,
            StockroomError::PrincipalProtection
        );
    }
    Ok(())
}
pub(crate) fn flush_fees<'info>(a: &mut ManagePosition<'info>) -> Result<()> {
    let p = &mut a.position;
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.token_program.to_account_info(),
        a.cash.to_account_info(),
        a.treasury.to_account_info(),
        p.to_account_info(),
        p.pending_fees,
        Some(seeds),
    )?;
    p.pending_fees = 0;
    Ok(())
}
pub fn harvest<'info>(
    ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
    withdraw_accounts: u16,
    min_redeemed: u64,
    min_shares: u64,
) -> Result<()> {
    let a = ctx.accounts;
    require!(!a.config.paused, StockroomError::Paused);
    require!(
        a.position.status == PositionStatus::Active,
        StockroomError::State
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= a.position.updated_at + 3600,
        StockroomError::NotTriggered
    );
    let split = withdraw_accounts as usize;
    require!(split <= ctx.remaining_accounts.len(), StockroomError::Vault);
    let (withdraw, deposit) = ctx.remaining_accounts.split_at(split);
    kamino::redeposit_overhead(withdraw.get(1).ok_or(StockroomError::Vault)?)?;
    let gross_before = a.position.gross_yield;
    let principal = redeem_all(a, withdraw, min_redeemed)?;
    require!(
        a.position.gross_yield.saturating_sub(gross_before) >= 100_000,
        StockroomError::NotTriggered
    );
    // Reinvestment overhead is reserved from protocol fees, never user net yield or principal.
    require!(
        principal == a.position.principal_basis,
        StockroomError::PrincipalProtection
    );
    reinvest(a, deposit, principal, min_shares, true)?;
    flush_fees(a)?;
    a.position.updated_at = now;
    emit_activity(
        a.position.owner,
        a.position.key(),
        3,
        a.position.gross_yield - gross_before,
        0,
    )
}
pub fn withdraw<'info>(
    ctx: Context<'_, '_, '_, 'info, ManagePosition<'info>>,
    amount: u64,
    withdraw_accounts: u16,
    min_redeemed: u64,
    min_shares: u64,
    cancel: bool,
) -> Result<()> {
    let a = ctx.accounts;
    require_keys_eq!(
        a.actor.key(),
        a.position.owner,
        StockroomError::Unauthorized
    );
    require!(
        a.position.status == PositionStatus::Active,
        StockroomError::State
    );
    require!(
        (cancel && a.position.kind != PositionKind::Earn)
            || (!cancel && a.position.kind == PositionKind::Earn),
        StockroomError::State
    );
    let split = withdraw_accounts as usize;
    require!(split <= ctx.remaining_accounts.len(), StockroomError::Vault);
    let (withdraw, deposit) = ctx.remaining_accounts.split_at(split);
    let principal = redeem_all(a, withdraw, min_redeemed)?;
    let take = if cancel || amount == u64::MAX {
        principal
    } else {
        amount
    };
    require!(take > 0 || cancel, StockroomError::Balance);
    require!(take <= principal, StockroomError::Balance);
    a.position.principal_basis = math(stockroom_math::remaining_basis(
        a.position.principal_basis,
        principal,
        take,
    ))?;
    reinvest(a, deposit, principal - take, min_shares, false)?;
    flush_fees(a)?;
    let p = &mut a.position;
    let total = if cancel {
        let total = math(stockroom_math::add(take, p.claimable))?;
        p.claimable = 0;
        p.status = PositionStatus::Cancelled;
        total
    } else {
        take
    };
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.token_program.to_account_info(),
        a.cash.to_account_info(),
        a.owner_cash.to_account_info(),
        p.to_account_info(),
        total,
        Some(seeds),
    )?;
    p.updated_at = Clock::get()?.unix_timestamp;
    emit_activity(owner, p.key(), if cancel { 5 } else { 4 }, total, 0)
}
pub fn claim(ctx: Context<ManagePosition>, amount: u64) -> Result<()> {
    let a = ctx.accounts;
    let p = &mut a.position;
    require_keys_eq!(a.actor.key(), p.owner, StockroomError::Unauthorized);
    require!(amount > 0, StockroomError::Balance);
    p.claimable = math(stockroom_math::sub(p.claimable, amount))?;
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.token_program.to_account_info(),
        a.cash.to_account_info(),
        a.owner_cash.to_account_info(),
        p.to_account_info(),
        amount,
        Some(seeds),
    )?;
    emit_activity(owner, p.key(), 6, amount, 0)
}
pub fn settle_yield<'info>(
    ctx: Context<'_, '_, '_, 'info, SettlePosition<'info>>,
    amount: u64,
    delivered: u64,
) -> Result<()> {
    let a = ctx.accounts;
    a.base.config.check_product(position_products(
        a.base.position.kind,
        a.base.position.destination,
    ))?;
    let p = &a.base.position;
    require!(
        p.status == PositionStatus::Active
            && p.kind == PositionKind::Earn
            && p.destination == Destination::Stocks,
        StockroomError::State
    );
    require!(
        amount >= 1_000_000 && amount <= p.claimable,
        StockroomError::Balance
    );
    let spec = a
        .base
        .manifest
        .stocks
        .get(p.stock_index as usize)
        .ok_or(StockroomError::Manifest)?;
    tokens::validate_stock(spec, &a.stock_mint, a.stock_program.key())?;
    let minimum = oracle::minimum(
        &a.base.config,
        spec,
        &a.stock_mint.to_account_info(),
        &a.stock_price.to_account_info(),
        &a.usdc_price.to_account_info(),
        amount,
        p.slippage_bps,
        None,
    )?;
    let before = a.owner_stock.amount;
    tokens::deliver(
        a.stock_program.to_account_info(),
        a.solver_stock.to_account_info(),
        a.stock_mint.to_account_info(),
        a.owner_stock.to_account_info(),
        a.base.actor.to_account_info(),
        delivered,
        spec.decimals,
        ctx.remaining_accounts,
    )?;
    a.owner_stock.reload()?;
    let received = math(stockroom_math::sub(a.owner_stock.amount, before))?;
    require!(received >= minimum, StockroomError::Delivery);
    let p = &mut a.base.position;
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.base.token_program.to_account_info(),
        a.base.cash.to_account_info(),
        a.solver_cash.to_account_info(),
        p.to_account_info(),
        amount,
        Some(seeds),
    )?;
    p.claimable = math(stockroom_math::sub(p.claimable, amount))?;
    p.allocated_yield = math(stockroom_math::add(p.allocated_yield, amount))?;
    p.stock_units_received = math(stockroom_math::add(p.stock_units_received, received))?;
    p.stock_usdc_spent = math(stockroom_math::add(p.stock_usdc_spent, amount))?;
    emit_activity(owner, p.key(), 7, amount, received)
}
pub fn fill<'info>(
    ctx: Context<'_, '_, '_, 'info, SettlePosition<'info>>,
    delivered: u64,
    withdraw_accounts: u16,
    min_redeemed: u64,
    min_shares: u64,
    stock_transfer_accounts: u16,
) -> Result<()> {
    let a = ctx.accounts;
    a.base.config.check_product(position_products(
        a.base.position.kind,
        a.base.position.destination,
    ))?;
    let p = &a.base.position;
    let now = Clock::get()?.unix_timestamp;
    require!(
        p.status == PositionStatus::Active && p.kind != PositionKind::Earn,
        StockroomError::State
    );
    require!(now < p.expires_at, StockroomError::Expired);
    require!(now >= p.next_fill_at, StockroomError::NotTriggered);
    let spec = a
        .base
        .manifest
        .stocks
        .get(p.stock_index as usize)
        .ok_or(StockroomError::Manifest)?
        .clone();
    tokens::validate_stock(&spec, &a.stock_mint, a.stock_program.key())?;
    let split = withdraw_accounts as usize;
    let end = ctx
        .remaining_accounts
        .len()
        .checked_sub(stock_transfer_accounts as usize)
        .ok_or(StockroomError::Vault)?;
    require!(split <= end, StockroomError::Vault);
    let (vault_accounts, hook_accounts) = ctx.remaining_accounts.split_at(end);
    let (withdraw, deposit) = vault_accounts.split_at(split);
    kamino::redeposit_overhead(withdraw.get(1).ok_or(StockroomError::Vault)?)?;
    let principal = redeem_all(&mut a.base, withdraw, min_redeemed)?;
    let p = &mut a.base.position;
    let steps = p.steps_remaining as u64;
    require!(steps > 0, StockroomError::State);
    let principal_part = principal / steps;
    let yield_part = p.claimable / steps;
    let raw = math(stockroom_math::add(principal_part, yield_part))?;
    let trading_fee = math(stockroom_math::fee(raw, p.trade_fee_bps))?;
    let budget = math(stockroom_math::sub(raw, trading_fee))?;
    let limit = (p.kind == PositionKind::Limit).then_some(p.target_price);
    let minimum = oracle::minimum(
        &a.base.config,
        &spec,
        &a.stock_mint.to_account_info(),
        &a.stock_price.to_account_info(),
        &a.usdc_price.to_account_info(),
        budget,
        p.slippage_bps,
        limit,
    )?;
    let before = a.owner_stock.amount;
    tokens::deliver(
        a.stock_program.to_account_info(),
        a.solver_stock.to_account_info(),
        a.stock_mint.to_account_info(),
        a.owner_stock.to_account_info(),
        a.base.actor.to_account_info(),
        delivered,
        spec.decimals,
        hook_accounts,
    )?;
    a.owner_stock.reload()?;
    let received = math(stockroom_math::sub(a.owner_stock.amount, before))?;
    require!(received >= minimum, StockroomError::Delivery);
    let owner = p.owner;
    let id = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.base.token_program.to_account_info(),
        a.base.cash.to_account_info(),
        a.solver_cash.to_account_info(),
        p.to_account_info(),
        budget,
        Some(seeds),
    )?;
    p.pending_fees = math(stockroom_math::add(p.pending_fees, trading_fee))?;
    p.claimable = math(stockroom_math::sub(p.claimable, yield_part))?;
    p.principal_basis = math(stockroom_math::remaining_basis(
        p.principal_basis,
        principal,
        principal_part,
    ))?;
    p.steps_remaining -= 1;
    p.next_fill_at = now
        .checked_add(p.interval_seconds as i64)
        .ok_or(StockroomError::Math)?;
    p.stock_units_received = math(stockroom_math::add(p.stock_units_received, received))?;
    p.stock_usdc_spent = math(stockroom_math::add(p.stock_usdc_spent, budget))?;
    if p.steps_remaining == 0 {
        p.status = PositionStatus::Filled;
    }
    p.updated_at = now;
    reinvest(
        &mut a.base,
        deposit,
        principal - principal_part,
        min_shares,
        true,
    )?;
    flush_fees(&mut a.base)?;
    emit_activity(owner, a.base.position.key(), 8, budget, received)
}
