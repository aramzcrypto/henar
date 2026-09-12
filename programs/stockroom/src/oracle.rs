use crate::state::*;
use anchor_lang::prelude::*;
use stockroom_math::Price;
// Pyth Receiver PriceUpdateV2 wire layout, as defined by the official SDK.
// Full verification is mandatory; partial-signature updates are never accepted.
pub const PYTH_RECEIVER: Pubkey = pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");
#[derive(AnchorDeserialize)]
enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}
#[derive(AnchorDeserialize)]
struct PriceFeedMessage {
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    prev_publish_time: i64,
    ema_price: i64,
    ema_conf: u64,
}
#[derive(AnchorDeserialize)]
struct PriceUpdate {
    write_authority: Pubkey,
    verification_level: VerificationLevel,
    price_message: PriceFeedMessage,
    posted_slot: u64,
}
pub fn read_price(account: &AccountInfo, feed: &[u8; 32], config: &Config) -> Result<Price> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER, StockroomError::Oracle);
    let data = account.try_borrow_data()?;
    let expected = solana_sha256_hasher::hash(b"account:PriceUpdateV2");
    require!(
        data.len() >= 8 && data[..8] == expected.to_bytes()[..8],
        StockroomError::Oracle
    );
    let update =
        PriceUpdate::deserialize(&mut &data[8..]).map_err(|_| error!(StockroomError::Oracle))?;
    require!(
        matches!(update.verification_level, VerificationLevel::Full),
        StockroomError::Oracle
    );
    require!(
        &update.price_message.feed_id == feed,
        StockroomError::Oracle
    );
    let clock = Clock::get()?;
    require!(update.posted_slot <= clock.slot, StockroomError::Oracle);
    let p = update.price_message;
    Price {
        value: p.price,
        confidence: p.conf,
        exponent: p.exponent,
        publish_time: p.publish_time,
    }
    .checked(
        clock.unix_timestamp,
        config.oracle_max_age,
        config.max_confidence_bps,
    )
    .map_err(|_| error!(StockroomError::Oracle))
}
pub fn minimum(
    config: &Config,
    spec: &StockSpec,
    mint: &AccountInfo,
    stock_feed: &AccountInfo,
    usdc_feed: &AccountInfo,
    budget: u64,
    slippage: u16,
    limit: Option<u64>,
) -> Result<u64> {
    require!(slippage <= config.max_slippage_bps, StockroomError::Config);
    let stock = read_price(stock_feed, &spec.feed, config)?;
    let usdc = read_price(usdc_feed, &config.usdc_feed, config)?;
    let price = math(stockroom_math::price_in_usdc(
        stock,
        usdc,
        spec.ratio_numerator,
        spec.ratio_denominator,
    ))?;
    let bits = crate::tokens::ui_multiplier_bits(mint)?;
    let price = math(stockroom_math::scaled_price(price, bits))?;
    let limit = limit
        .map(|value| math(stockroom_math::scaled_price(value, bits)))
        .transpose()?;
    stockroom_math::minimum_stock(budget, price, spec.decimals, slippage, limit).map_err(
        |e| match e {
            stockroom_math::MathError::NotTriggered => error!(StockroomError::NotTriggered),
            _ => error!(StockroomError::Oracle),
        },
    )
}
