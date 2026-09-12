use crate::{contexts::*, oracle, state::*, tokens};
use anchor_lang::prelude::*;
use orao_solana_vrf::{state::RandomnessAccountData, RANDOMNESS_ACCOUNT_SEED};
use solana_sha256_hasher::hashv;

pub fn buy(ctx: Context<BuyBatch>, id: u64, count: u64, slippage_bps: u16) -> Result<()> {
    require!(!ctx.accounts.config.paused, StockroomError::Paused);
    require!(
        slippage_bps <= ctx.accounts.config.max_slippage_bps,
        StockroomError::Config
    );
    require!(
        ctx.accounts.manifest.stocks.iter().any(|s| s.pack_eligible),
        StockroomError::Manifest
    );
    let total = math(stockroom_math::pack_total(count))?;
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.owner_cash.to_account_info(),
        ctx.accounts.batch_cash.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        total,
        None,
    )?;
    let batch = &mut ctx.accounts.batch;
    ***batch = PackBatch {
        creator: ctx.accounts.owner.key(),
        owner: ctx.accounts.owner.key(),
        config: ctx.accounts.config.key(),
        manifest: ctx.accounts.manifest.key(),
        id,
        remaining: count,
        next_open: 0,
        unit_fee: math(stockroom_math::fee(
            PACK_USDC,
            ctx.accounts.config.pack_fee_bps,
        ))?,
        slippage_bps,
        source: PackSource::Purchased,
        created_at: Clock::get()?.unix_timestamp,
        sender: Pubkey::default(),
        message: String::new(),
        bump: ctx.bumps.batch,
    };
    emit_activity(batch.owner, batch.key(), 10, total, count)
}
pub fn from_yield(ctx: Context<YieldBatch>, id: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, StockroomError::Paused);
    let p = &mut ctx.accounts.position;
    require!(
        p.status == PositionStatus::Active
            && p.kind == PositionKind::Earn
            && p.destination == Destination::Packs
            && p.auto_packs,
        StockroomError::State
    );
    require!(
        ctx.accounts.manifest.stocks.iter().any(|s| s.pack_eligible),
        StockroomError::Manifest
    );
    let (count, remainder) = stockroom_math::pack_allocation(p.claimable);
    let total = math(stockroom_math::pack_total(count))?;
    let owner = p.owner;
    let pid = p.id.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"position".as_ref(),
        owner.as_ref(),
        pid.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.position_cash.to_account_info(),
        ctx.accounts.batch_cash.to_account_info(),
        p.to_account_info(),
        total,
        Some(seeds),
    )?;
    p.claimable = remainder;
    p.allocated_yield = math(stockroom_math::add(p.allocated_yield, total))?;
    p.updated_at = Clock::get()?.unix_timestamp;
    let batch = &mut ctx.accounts.batch;
    ***batch = PackBatch {
        creator: ctx.accounts.payer.key(),
        owner,
        config: ctx.accounts.config.key(),
        manifest: ctx.accounts.manifest.key(),
        id,
        remaining: count,
        next_open: 0,
        unit_fee: 0,
        slippage_bps: p.slippage_bps,
        source: PackSource::Earned,
        created_at: Clock::get()?.unix_timestamp,
        sender: Pubkey::default(),
        message: String::new(),
        bump: ctx.bumps.batch,
    };
    emit_activity(owner, batch.key(), 11, total, count)
}
pub fn gift(
    ctx: Context<GiftBatch>,
    id: u64,
    count: u64,
    recipient: Pubkey,
    message: String,
) -> Result<()> {
    require!(
        recipient != Pubkey::default() && recipient != ctx.accounts.owner.key(),
        StockroomError::Unauthorized
    );
    require!(
        message.len() <= 1024 && message.chars().count() <= 280,
        StockroomError::Message
    );
    let total = math(stockroom_math::pack_total(count))?;
    let batch = &mut ctx.accounts.batch;
    batch.remaining = math(stockroom_math::sub(batch.remaining, count))?;
    let creator = batch.creator;
    let bid = batch.id.to_le_bytes();
    let bump = [batch.bump];
    let seeds = &[
        b"batch".as_ref(),
        creator.as_ref(),
        bid.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.batch_cash.to_account_info(),
        ctx.accounts.gift_cash.to_account_info(),
        batch.to_account_info(),
        total,
        Some(seeds),
    )?;
    let gift = &mut ctx.accounts.gift;
    ***gift = PackBatch {
        creator: ctx.accounts.owner.key(),
        owner: recipient,
        config: batch.config,
        manifest: batch.manifest,
        id,
        remaining: count,
        next_open: 0,
        unit_fee: batch.unit_fee,
        slippage_bps: batch.slippage_bps,
        source: batch.source,
        created_at: Clock::get()?.unix_timestamp,
        sender: ctx.accounts.owner.key(),
        message,
        bump: ctx.bumps.gift,
    };
    emit_activity(recipient, gift.key(), 12, total, count)
}
pub fn refund_batch(ctx: Context<RefundBatch>, count: u64) -> Result<()> {
    let total = math(stockroom_math::pack_total(count))?;
    let batch = &mut ctx.accounts.batch;
    batch.remaining = math(stockroom_math::sub(batch.remaining, count))?;
    let creator = batch.creator;
    let bid = batch.id.to_le_bytes();
    let bump = [batch.bump];
    let seeds = &[
        b"batch".as_ref(),
        creator.as_ref(),
        bid.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.batch_cash.to_account_info(),
        ctx.accounts.owner_cash.to_account_info(),
        batch.to_account_info(),
        total,
        Some(seeds),
    )?;
    emit_activity(batch.owner, batch.key(), 13, total, count)
}
pub fn open(ctx: Context<OpenPack>, index: u64, nonce: [u8; 32]) -> Result<()> {
    open_accounts(ctx.accounts, index, nonce, ctx.bumps.pack)
}
pub fn open_accounts(a: &mut OpenPack, index: u64, nonce: [u8; 32], pack_bump: u8) -> Result<()> {
    require!(!a.config.paused, StockroomError::Paused);
    let batch = &mut a.batch;
    require!(
        batch.remaining > 0 && batch.next_open == index,
        StockroomError::State
    );
    let pack_key = a.pack.key();
    let force = hashv(&[
        b"stockroom-v1-vrf",
        crate::ID.as_ref(),
        pack_key.as_ref(),
        &nonce,
    ])
    .to_bytes();
    let expected =
        Pubkey::find_program_address(&[RANDOMNESS_ACCOUNT_SEED, &force], &orao_solana_vrf::ID).0;
    require_keys_eq!(a.randomness.key(), expected, StockroomError::Randomness);
    // Never accept an existing/pre-fulfilled request. Successful request and escrow debit are atomic.
    require!(a.randomness.data_is_empty(), StockroomError::Randomness);
    orao_solana_vrf::cpi::request_v2(
        CpiContext::new(
            a.orao_program.to_account_info(),
            orao_solana_vrf::cpi::accounts::RequestV2 {
                payer: a.owner.to_account_info(),
                network_state: a.network.to_account_info(),
                treasury: a.orao_treasury.to_account_info(),
                request: a.randomness.to_account_info(),
                system_program: a.system_program.to_account_info(),
            },
        ),
        force,
    )?;
    let creator = batch.creator;
    let bid = batch.id.to_le_bytes();
    let bump = [batch.bump];
    let seeds = &[
        b"batch".as_ref(),
        creator.as_ref(),
        bid.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        a.token_program.to_account_info(),
        a.batch_cash.to_account_info(),
        a.pack_cash.to_account_info(),
        batch.to_account_info(),
        PACK_USDC,
        Some(seeds),
    )?;
    batch.remaining = math(stockroom_math::sub(batch.remaining, 1))?;
    batch.next_open = math(stockroom_math::add(batch.next_open, 1))?;
    let now = Clock::get()?.unix_timestamp;
    let pack = &mut a.pack;
    ***pack = Pack {
        owner: batch.owner,
        batch: batch.key(),
        config: a.config.key(),
        manifest: batch.manifest,
        index,
        force,
        unit_fee: batch.unit_fee,
        slippage_bps: batch.slippage_bps,
        stock_index: u16::MAX,
        source: batch.source,
        status: PackStatus::Pending,
        units_received: 0,
        ui_multiplier_bits: 0x3ff0000000000000,
        stock_value: 0,
        created_at: now,
        expires_at: now
            .checked_add(a.config.pack_timeout as i64)
            .ok_or(StockroomError::Math)?,
        settled_at: 0,
        lucky: false,
        round: 0,
        stake: 0,
        budget: math(stockroom_math::sub(PACK_USDC, batch.unit_fee))?,
        bump: pack_bump,
    };
    emit_activity(pack.owner, pack.key(), 14, PACK_USDC, 1)
}
/// Rejection sampling removes modulo bias. Domain-separated expansion is deterministic onchain.
pub fn sample(randomness: &[u8; 64], n: usize) -> Result<usize> {
    sample_domain(randomness, n, b"stockroom-selection-v1")
}
pub fn sample_domain(randomness: &[u8; 64], n: usize, domain: &[u8]) -> Result<usize> {
    require!(n > 0 && n <= 100, StockroomError::Manifest);
    let divisor = n as u64;
    let threshold = divisor.wrapping_neg() % divisor;
    for counter in 0u32..64 {
        let bytes = hashv(&[domain, randomness, &counter.to_le_bytes()]).to_bytes();
        let value = u64::from_le_bytes(
            bytes[..8]
                .try_into()
                .map_err(|_| error!(StockroomError::Randomness))?,
        );
        if value >= threshold {
            return Ok((value % divisor) as usize);
        }
    }
    err!(StockroomError::Randomness)
}
pub fn resolve(ctx: Context<ResolvePack>) -> Result<()> {
    let p = &mut ctx.accounts.pack;
    require!(!p.lucky, StockroomError::State);
    if p.status == PackStatus::Selected {
        return Ok(());
    }
    require!(p.status == PackStatus::Pending, StockroomError::State);
    require!(
        Clock::get()?.unix_timestamp < p.expires_at,
        StockroomError::Expired
    );
    let r = &ctx.accounts.randomness;
    require_keys_eq!(*r.owner, orao_solana_vrf::ID, StockroomError::Randomness);
    require_keys_eq!(
        r.key(),
        Pubkey::find_program_address(&[RANDOMNESS_ACCOUNT_SEED, &p.force], &orao_solana_vrf::ID).0,
        StockroomError::Randomness
    );
    let data = RandomnessAccountData::try_deserialize(&mut &r.try_borrow_data()?[..])?;
    require!(
        data.seed() == &p.force && data.client() == Some(&p.owner),
        StockroomError::Randomness
    );
    let randomness = data
        .fulfilled_randomness()
        .ok_or(StockroomError::RandomnessPending)?;
    let eligible: Vec<usize> = ctx
        .accounts
        .manifest
        .stocks
        .iter()
        .enumerate()
        .filter_map(|(i, s)| s.pack_eligible.then_some(i))
        .collect();
    p.stock_index = eligible[sample(randomness, eligible.len())?] as u16;
    p.status = PackStatus::Selected;
    emit_activity(p.owner, p.key(), 15, PACK_USDC, p.stock_index as u64)
}
pub fn settle<'info>(
    ctx: Context<'_, '_, '_, 'info, SettlePack<'info>>,
    deliver_amount: u64,
) -> Result<()> {
    let p = &mut ctx.accounts.pack;
    require!(p.status == PackStatus::Selected, StockroomError::State);
    require!(
        Clock::get()?.unix_timestamp < p.expires_at,
        StockroomError::Expired
    );
    let spec = ctx
        .accounts
        .manifest
        .stocks
        .get(p.stock_index as usize)
        .ok_or(StockroomError::Manifest)?;
    tokens::validate_stock(
        spec,
        &ctx.accounts.stock_mint,
        ctx.accounts.stock_program.key(),
    )?;
    let budget = p.budget;
    let minimum = oracle::minimum(
        &ctx.accounts.config,
        spec,
        &ctx.accounts.stock_mint.to_account_info(),
        &ctx.accounts.stock_price.to_account_info(),
        &ctx.accounts.usdc_price.to_account_info(),
        budget,
        p.slippage_bps,
        None,
    )?;
    let before = ctx.accounts.owner_stock.amount;
    tokens::deliver(
        ctx.accounts.stock_program.to_account_info(),
        ctx.accounts.solver_stock.to_account_info(),
        ctx.accounts.stock_mint.to_account_info(),
        ctx.accounts.owner_stock.to_account_info(),
        ctx.accounts.solver.to_account_info(),
        deliver_amount,
        spec.decimals,
        ctx.remaining_accounts,
    )?;
    ctx.accounts.owner_stock.reload()?;
    let received = math(stockroom_math::sub(ctx.accounts.owner_stock.amount, before))?;
    require!(received >= minimum, StockroomError::Delivery);
    let batch = p.batch;
    let index = p.index.to_le_bytes();
    let bump = [p.bump];
    let seeds = &[
        b"pack".as_ref(),
        batch.as_ref(),
        index.as_ref(),
        bump.as_ref(),
    ];
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.pack_cash.to_account_info(),
        ctx.accounts.solver_cash.to_account_info(),
        p.to_account_info(),
        budget,
        Some(seeds),
    )?;
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.pack_cash.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
        p.to_account_info(),
        p.unit_fee,
        Some(seeds),
    )?;
    p.status = PackStatus::Settled;
    p.units_received = received;
    p.ui_multiplier_bits = tokens::ui_multiplier_bits(&ctx.accounts.stock_mint.to_account_info())?;
    p.stock_value = budget;
    p.settled_at = Clock::get()?.unix_timestamp;
    emit_activity(p.owner, p.key(), 16, budget, received)
}
pub fn refund(ctx: Context<RefundPack>) -> Result<()> {
    let p = &mut ctx.accounts.pack;
    require!(!p.lucky, StockroomError::State);
    require!(
        matches!(p.status, PackStatus::Pending | PackStatus::Selected),
        StockroomError::State
    );
    require!(
        Clock::get()?.unix_timestamp >= p.expires_at,
        StockroomError::NotExpired
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
    tokens::pay(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.pack_cash.to_account_info(),
        ctx.accounts.owner_cash.to_account_info(),
        p.to_account_info(),
        PACK_USDC,
        Some(seeds),
    )?;
    p.status = PackStatus::Refunded;
    p.settled_at = Clock::get()?.unix_timestamp;
    emit_activity(p.owner, p.key(), 17, PACK_USDC, 0)
}
