use anchor_lang::prelude::*;

pub const MAX_STOCKS: usize = 64;
pub const PACK_USDC: u64 = 10_000_000;
pub const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const KVAULT: Pubkey = pubkey!("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd");
pub const KLEND: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub treasury: Pubkey,
    pub vault: Pubkey,
    pub shares_mint: Pubkey,
    pub active_manifest: Pubkey,
    pub usdc_feed: [u8; 32],
    pub yield_share_bps: u16,
    pub pack_fee_bps: u16,
    pub trade_fee_bps: u16,
    pub max_slippage_bps: u16,
    pub max_confidence_bps: u16,
    pub oracle_max_age: u32,
    pub pack_timeout: u32,
    pub paused: bool,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Debug, PartialEq)]
pub struct StockSpec {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub feed: [u8; 32],
    pub ratio_numerator: u64,
    pub ratio_denominator: u64,
    pub decimals: u8,
    pub pack_eligible: bool,
}
#[account]
#[derive(InitSpace)]
pub struct Manifest {
    pub config: Pubkey,
    pub sealed: bool,
    pub version: u64,
    #[max_len(64)]
    pub stocks: Vec<StockSpec>,
    pub created_at: i64,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionKind {
    Earn,
    Limit,
    Dca,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Destination {
    Packs,
    Stocks,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionStatus {
    Active,
    Filled,
    Cancelled,
}
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub config: Pubkey,
    pub manifest: Pubkey,
    pub id: u64,
    pub principal_basis: u64,
    pub shares: u64,
    pub invested_fee_basis: u64,
    pub pending_fees: u64,
    pub claimable: u64,
    pub gross_yield: u64,
    pub yield_fees: u64,
    pub allocated_yield: u64,
    pub stock_units_received: u64,
    pub stock_usdc_spent: u64,
    pub stock_index: u16,
    pub yield_share_bps: u16,
    pub trade_fee_bps: u16,
    pub fee_carry: u16,
    pub slippage_bps: u16,
    pub kind: PositionKind,
    pub destination: Destination,
    pub auto_packs: bool,
    pub status: PositionStatus,
    pub target_price: u64,
    pub steps_remaining: u16,
    pub interval_seconds: u32,
    pub next_fill_at: i64,
    pub expires_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackSource {
    Purchased,
    Earned,
}
#[account]
#[derive(InitSpace)]
pub struct PackBatch {
    pub creator: Pubkey,
    pub owner: Pubkey,
    pub config: Pubkey,
    pub manifest: Pubkey,
    pub id: u64,
    pub remaining: u64,
    pub next_open: u64,
    pub unit_fee: u64,
    pub slippage_bps: u16,
    pub source: PackSource,
    pub created_at: i64,
    pub sender: Pubkey,
    #[max_len(1024)]
    pub message: String,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackStatus {
    Pending,
    Selected,
    Settled,
    Refunded,
}
#[account]
#[derive(InitSpace)]
pub struct Pack {
    pub owner: Pubkey,
    pub batch: Pubkey,
    pub config: Pubkey,
    pub manifest: Pubkey,
    pub index: u64,
    pub force: [u8; 32],
    pub unit_fee: u64,
    pub slippage_bps: u16,
    pub stock_index: u16,
    pub source: PackSource,
    pub status: PackStatus,
    pub units_received: u64,
    pub ui_multiplier_bits: u64,
    pub stock_value: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}
#[event]
pub struct Activity {
    pub owner: Pubkey,
    pub account: Pubkey,
    pub action: u8,
    pub usdc: u64,
    pub units: u64,
    pub timestamp: i64,
}
#[error_code]
pub enum StockroomError {
    #[msg("Arithmetic overflow or invalid amount")]
    Math,
    #[msg("Unauthorized authority or account")]
    Unauthorized,
    #[msg("New deposits and purchases are paused")]
    Paused,
    #[msg("Invalid immutable stock manifest")]
    Manifest,
    #[msg("Unsupported stock mint or token program")]
    Mint,
    #[msg("Incorrect USDC or vault accounts")]
    Vault,
    #[msg("Position or pack state does not allow this action")]
    State,
    #[msg("Insufficient available principal or yield")]
    Balance,
    #[msg("Deadline has passed")]
    Expired,
    #[msg("Refund is not yet available")]
    NotExpired,
    #[msg("Verifiable randomness is not fulfilled")]
    RandomnessPending,
    #[msg("Invalid randomness request or client")]
    Randomness,
    #[msg("Insufficient stock delivered after transfer fees")]
    Delivery,
    #[msg("Invalid, stale, uncertain, or unverified oracle price")]
    Oracle,
    #[msg("Order price or schedule is not triggered")]
    NotTriggered,
    #[msg("Unsafe configuration")]
    Config,
    #[msg("Vault fees or rounding would consume protected principal")]
    PrincipalProtection,
    #[msg("Message exceeds 280 characters or 1024 UTF-8 bytes")]
    Message,
    #[msg("Only top-level user calls are allowed for this instruction")]
    Cpi,
}
pub fn math<T>(r: stockroom_math::Result<T>) -> Result<T> {
    r.map_err(|_| error!(StockroomError::Math))
}
pub fn emit_activity(
    owner: Pubkey,
    account: Pubkey,
    action: u8,
    usdc: u64,
    units: u64,
) -> Result<()> {
    emit!(Activity {
        owner,
        account,
        action,
        usdc,
        units,
        timestamp: Clock::get()?.unix_timestamp
    });
    Ok(())
}
