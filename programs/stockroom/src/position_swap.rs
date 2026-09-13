//! Direct position escrow swaps. No external price feed is required.
//! Quote quality is trusted; custody, limit price, schedule and net delivery are enforced here.
use crate::{
    contexts::*,
    pack_swap::{PackExecution, JUPITER},
    positions,
    state::*,
    tokens,
};
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PositionSwapTerms {
    pub input: u64,
    pub quoted_output: u64,
    pub minimum_output: u64,
    pub quoted_at: i64,
    pub withdraw_accounts: u16,
    pub deposit_accounts: u16,
    pub minimum_redeemed: u64,
    pub minimum_shares: u64,
}
#[derive(Accounts)]
pub struct SwapPosition<'info> {
    pub base: ManagePosition<'info>,
    #[account(seeds=[b"pack-execution"],bump=execution.bump,
        constraint=execution.authority==base.actor.key() @ StockroomError::Unauthorized)]
    pub execution: Account<'info, PackExecution>,
    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut,token::mint=stock_mint,token::token_program=stock_program,
        constraint=owner_stock.owner==base.position.owner @ StockroomError::Unauthorized)]
    pub owner_stock: Box<InterfaceAccount<'info, TokenAccount>>,
    pub stock_program: Interface<'info, TokenInterface>,
    /// CHECK: Pinned executable router.
    #[account(address=JUPITER,executable)]
    pub jupiter: UncheckedAccount<'info>,
}

fn validate_route(
    a: &SwapPosition,
    t: &PositionSwapTerms,
    data: &[u8],
    accounts: &[AccountInfo],
) -> Result<()> {
    require!(
        data.len() >= 35 && data.len() <= 1024 && accounts.len() >= 10,
        StockroomError::Config
    );
    require!(
        data[..8] == [187, 100, 250, 204, 49, 196, 175, 20],
        StockroomError::Config
    );
    let input = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let output = u64::from_le_bytes(data[16..24].try_into().unwrap());
    let slippage = u16::from_le_bytes(data[24..26].try_into().unwrap());
    let steps = u32::from_le_bytes(data[30..34].try_into().unwrap());
    require!(steps > 0 && steps <= 16, StockroomError::Config);
    require!(
        input == t.input
            && output == t.quoted_output
            && slippage <= a.base.position.slippage_bps
            && data[26..30] == [0, 0, 0, 0],
        StockroomError::Delivery
    );
    let escrow_stock = anchor_spl::associated_token::get_associated_token_address_with_program_id(
        &a.base.position.key(),
        &a.stock_mint.key(),
        &a.stock_program.key(),
    );
    require!(
        accounts[2].key() == a.owner_stock.key() || accounts[2].key() == escrow_stock,
        StockroomError::Unauthorized
    );
    let expected = [
        a.base.position.key(),
        a.base.cash.key(),
        accounts[2].key(),
        USDC,
        a.stock_mint.key(),
        a.base.token_program.key(),
        a.stock_program.key(),
    ];
    for (account, key) in accounts.iter().zip(expected) {
        require_keys_eq!(account.key(), key, StockroomError::Unauthorized);
    }
    require!(
        accounts[7].key() == a.owner_stock.key()
            || (accounts[2].key() == a.owner_stock.key() && accounts[7].key() == JUPITER),
        StockroomError::Unauthorized
    );
    let event = Pubkey::find_program_address(&[b"__event_authority"], &JUPITER).0;
    require_keys_eq!(accounts[8].key(), event, StockroomError::Unauthorized);
    require_keys_eq!(accounts[9].key(), JUPITER, StockroomError::Unauthorized);
    Ok(())
}

pub fn swap<'info>(
    ctx: Context<'_, '_, '_, 'info, SwapPosition<'info>>,
    t: PositionSwapTerms,
    route: Vec<u8>,
) -> Result<()> {
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    let kind = a.base.position.kind;
    a.base
        .config
        .check_product(position_products(kind, a.base.position.destination))?;
    require!(a.execution.enabled, StockroomError::Paused);
    require!(
        a.base.position.status == PositionStatus::Active,
        StockroomError::State
    );
    require!(
        t.quoted_at <= now && now - t.quoted_at <= 30,
        StockroomError::Expired
    );
    require!(
        t.input > 0
            && t.input <= a.execution.max_budget
            && t.minimum_output > 0
            && t.minimum_output <= t.quoted_output,
        StockroomError::Delivery
    );
    let slip = a.base.position.slippage_bps;
    require!(
        slip <= a.base.config.max_slippage_bps && slip <= 100,
        StockroomError::Config
    );
    let floor = (t.quoted_output as u128 * (10000 - slip) as u128 + 9999) / 10000;
    require!(t.minimum_output as u128 >= floor, StockroomError::Delivery);
    let split = t.withdraw_accounts as usize;
    let end = split
        .checked_add(t.deposit_accounts as usize)
        .ok_or(StockroomError::Math)?;
    require!(end <= ctx.remaining_accounts.len(), StockroomError::Vault);
    let (vault, route_accounts) = ctx.remaining_accounts.split_at(end);
    let (withdraw, deposit) = vault.split_at(split);
    validate_route(a, &t, &route, route_accounts)?;
    let spec = a
        .base
        .manifest
        .stocks
        .get(a.base.position.stock_index as usize)
        .ok_or(StockroomError::Manifest)?
        .clone();
    tokens::validate_stock(&spec, &a.stock_mint, a.stock_program.key())?;

    let mut principal = 0;
    let mut principal_part = 0;
    let mut yield_part = 0;
    let mut trading_fee = 0;
    let mut refund = 0;
    if kind == PositionKind::Earn {
        require!(
            a.base.position.destination == Destination::Stocks && split == 0 && end == 0,
            StockroomError::State
        );
        require!(
            t.input <= a.base.position.claimable,
            StockroomError::Balance
        );
    } else {
        require!(now < a.base.position.expires_at, StockroomError::Expired);
        require!(
            now >= a.base.position.next_fill_at && a.base.position.steps_remaining > 0,
            StockroomError::NotTriggered
        );
        principal = positions::redeem_all(&mut a.base, withdraw, t.minimum_redeemed)?;
        let steps = a.base.position.steps_remaining as u64;
        principal_part = principal / steps;
        yield_part = a.base.position.claimable / steps;
        let raw = math(stockroom_math::add(principal_part, yield_part))?;
        trading_fee = math(stockroom_math::fee(raw, a.base.position.trade_fee_bps))?;
        let available = math(stockroom_math::sub(raw, trading_fee))?;
        require!(
            t.input <= available
                && t.input as u128 * 10000 >= available as u128 * (10000 - slip) as u128,
            StockroomError::Balance
        );
        refund = available - t.input;
    }
    let before_cash = a.base.cash.amount;
    let before_stock = a.owner_stock.amount;
    let before_shares = a.base.shares.amount;
    let owner = a.base.position.owner;
    let id = a.base.position.id.to_le_bytes();
    let bump = [a.base.position.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        id.as_ref(),
        bump.as_ref(),
    ];
    let metas = route_accounts
        .iter()
        .map(|info| AccountMeta {
            pubkey: info.key(),
            is_writable: info.is_writable,
            is_signer: info.key() == a.base.position.key(),
        })
        .collect();
    invoke_signed(
        &Instruction {
            program_id: JUPITER,
            accounts: metas,
            data: route,
        },
        route_accounts,
        &[seeds],
    )?;
    a.base.cash.reload()?;
    a.owner_stock.reload()?;
    a.base.shares.reload()?;
    require!(
        a.base.shares.amount == before_shares
            && a.base.shares.delegate.is_none()
            && a.base.shares.close_authority.is_none(),
        StockroomError::PrincipalProtection
    );
    require_keys_eq!(
        a.base.shares.owner,
        a.base.position.key(),
        StockroomError::Unauthorized
    );
    require_keys_eq!(
        a.base.shares.mint,
        a.base.config.shares_mint,
        StockroomError::Mint
    );
    let spent = math(stockroom_math::sub(before_cash, a.base.cash.amount))?;
    let received = math(stockroom_math::sub(a.owner_stock.amount, before_stock))?;
    require!(
        spent == t.input && received >= t.minimum_output,
        StockroomError::Delivery
    );
    require_keys_eq!(
        a.base.cash.owner,
        a.base.position.key(),
        StockroomError::Unauthorized
    );
    require_keys_eq!(a.base.cash.mint, USDC, StockroomError::Mint);
    require!(
        a.base.cash.delegate.is_none() && a.base.cash.close_authority.is_none(),
        StockroomError::Unauthorized
    );
    require_keys_eq!(a.owner_stock.owner, owner, StockroomError::Unauthorized);
    require_keys_eq!(a.owner_stock.mint, spec.mint, StockroomError::Mint);
    if kind == PositionKind::Limit {
        let limit = math(stockroom_math::scaled_price_floor(
            a.base.position.target_price,
            tokens::ui_multiplier_bits(&a.stock_mint.to_account_info())?,
        ))?;
        let scale = 10u128
            .checked_pow(spec.decimals as u32)
            .ok_or(StockroomError::Math)?;
        let cost = math(stockroom_math::add(spent, trading_fee))? as u128;
        require!(
            limit > 0
                && cost.checked_mul(scale).ok_or(StockroomError::Math)?
                    <= received as u128 * limit as u128,
            StockroomError::NotTriggered
        );
    }
    if kind == PositionKind::Earn {
        a.base.position.claimable = math(stockroom_math::sub(a.base.position.claimable, spent))?;
        a.base.position.allocated_yield =
            math(stockroom_math::add(a.base.position.allocated_yield, spent))?;
    } else {
        tokens::pay(
            a.base.token_program.to_account_info(),
            a.base.cash.to_account_info(),
            a.base.owner_cash.to_account_info(),
            a.base.position.to_account_info(),
            refund,
            Some(seeds),
        )?;
        let p = &mut a.base.position;
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
        if p.steps_remaining == 0 {
            p.status = PositionStatus::Filled;
        }
        p.updated_at = now;
        positions::reinvest(
            &mut a.base,
            deposit,
            principal - principal_part,
            t.minimum_shares,
            true,
        )?;
        positions::flush_fees(&mut a.base)?;
    }
    let p = &mut a.base.position;
    p.stock_units_received = math(stockroom_math::add(p.stock_units_received, received))?;
    p.stock_usdc_spent = math(stockroom_math::add(p.stock_usdc_spent, spent))?;
    emit_activity(
        owner,
        p.key(),
        if kind == PositionKind::Earn { 7 } else { 8 },
        spent,
        received,
    )
}
