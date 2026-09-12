use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
    token_interface::{
        Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface,
    },
};
use orao_solana_vrf::{program::OraoVrf, state::NetworkState, CONFIG_ACCOUNT_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ StockroomError::Unauthorized,
        constraint = program_data.key() == Pubkey::find_program_address(&[crate::ID.as_ref()], &anchor_lang::solana_program::bpf_loader_upgradeable::ID).0 @ StockroomError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init,payer=admin,space=8+Config::INIT_SPACE,seeds=[b"config"],bump)]
    pub config: Account<'info, Config>,
    #[account(constraint=treasury.mint==USDC @ StockroomError::Mint)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// CHECK: Owner and decoded USDC/share fields verified in handler.
    pub vault: UncheckedAccount<'info>,
    pub shares_mint: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Admin<'info> {
    pub admin: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
}
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=pending_admin)]
    pub config: Account<'info, Config>,
}
#[derive(Accounts)]
#[instruction(version:u64)]
pub struct CreateManifest<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
    #[account(init,payer=admin,space=8+Manifest::INIT_SPACE,seeds=[b"manifest",&version.to_le_bytes()],bump)]
    pub manifest: Box<Account<'info, Manifest>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ActivateManifest<'info> {
    pub admin: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=admin)]
    pub config: Account<'info, Config>,
    #[account(mut,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
}
#[derive(Accounts)]
#[instruction(id:u64)]
pub struct CreatePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(address=config.active_manifest,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
    #[account(init,payer=owner,space=8+Position::INIT_SPACE,seeds=[b"position",owner.key().as_ref(),&id.to_le_bytes()],bump)]
    pub position: Box<Account<'info, Position>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=usdc,token::authority=owner)]
    pub owner_cash: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=owner,associated_token::mint=usdc,associated_token::authority=position)]
    pub cash: Box<Account<'info, TokenAccount>>,
    #[account(address=config.shares_mint)]
    pub shares_mint: Box<Account<'info, Mint>>,
    #[account(init,payer=owner,associated_token::mint=shares_mint,associated_token::authority=position)]
    pub shares: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManagePosition<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut,has_one=config,seeds=[b"position",position.owner.as_ref(),&position.id.to_le_bytes()],bump=position.bump)]
    pub position: Box<Account<'info, Position>>,
    #[account(address=position.manifest,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=usdc,constraint=owner_cash.owner==position.owner @ StockroomError::Unauthorized)]
    pub owner_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=position)]
    pub cash: Box<Account<'info, TokenAccount>>,
    #[account(address=config.shares_mint)]
    pub shares_mint: Box<Account<'info, Mint>>,
    #[account(mut,associated_token::mint=shares_mint,associated_token::authority=position)]
    pub shares: Box<Account<'info, TokenAccount>>,
    #[account(mut,address=config.treasury,token::mint=usdc)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct PositionOwner<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,seeds=[b"position",owner.key().as_ref(),&position.id.to_le_bytes()],bump=position.bump)]
    pub position: Box<Account<'info, Position>>,
    #[account(address=position.manifest)]
    pub manifest: Box<Account<'info, Manifest>>,
}
#[derive(Accounts)]
#[instruction(id:u64)]
pub struct BuyBatch<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(address=config.active_manifest,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
    #[account(init,payer=owner,space=8+PackBatch::INIT_SPACE,seeds=[b"batch",owner.key().as_ref(),&id.to_le_bytes()],bump)]
    pub batch: Box<Account<'info, PackBatch>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=usdc,token::authority=owner)]
    pub owner_cash: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=owner,associated_token::mint=usdc,associated_token::authority=batch)]
    pub batch_cash: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(id:u64)]
pub struct YieldBatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut,has_one=config,seeds=[b"position",position.owner.as_ref(),&position.id.to_le_bytes()],bump=position.bump)]
    pub position: Box<Account<'info, Position>>,
    #[account(address=config.active_manifest,has_one=config)]
    pub manifest: Box<Account<'info, Manifest>>,
    #[account(init,payer=payer,space=8+PackBatch::INIT_SPACE,seeds=[b"batch",payer.key().as_ref(),&id.to_le_bytes()],bump)]
    pub batch: Box<Account<'info, PackBatch>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=position)]
    pub position_cash: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=payer,associated_token::mint=usdc,associated_token::authority=batch)]
    pub batch_cash: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(id:u64)]
pub struct GiftBatch<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,seeds=[b"batch",batch.creator.as_ref(),&batch.id.to_le_bytes()],bump=batch.bump)]
    pub batch: Box<Account<'info, PackBatch>>,
    #[account(init,payer=owner,space=8+PackBatch::INIT_SPACE,seeds=[b"batch",owner.key().as_ref(),&id.to_le_bytes()],bump)]
    pub gift: Box<Account<'info, PackBatch>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=batch)]
    pub batch_cash: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=owner,associated_token::mint=usdc,associated_token::authority=gift)]
    pub gift_cash: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RefundBatch<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,seeds=[b"batch",batch.creator.as_ref(),&batch.id.to_le_bytes()],bump=batch.bump)]
    pub batch: Box<Account<'info, PackBatch>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=usdc,token::authority=owner)]
    pub owner_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=batch)]
    pub batch_cash: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
#[instruction(index:u64)]
pub struct OpenPack<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut,has_one=owner,has_one=config,seeds=[b"batch",batch.creator.as_ref(),&batch.id.to_le_bytes()],bump=batch.bump)]
    pub batch: Box<Account<'info, PackBatch>>,
    #[account(init,payer=owner,space=8+Pack::INIT_SPACE,seeds=[b"pack",batch.key().as_ref(),&index.to_le_bytes()],bump)]
    pub pack: Box<Account<'info, Pack>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=batch)]
    pub batch_cash: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=owner,associated_token::mint=usdc,associated_token::authority=pack)]
    pub pack_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,seeds=[CONFIG_ACCOUNT_SEED],bump,seeds::program=orao_solana_vrf::ID)]
    pub network: Account<'info, NetworkState>,
    /// CHECK: ORAO validates the network treasury in RequestV2.
    #[account(mut)]
    pub orao_treasury: UncheckedAccount<'info>,
    /// CHECK: Canonical ORAO PDA verified from the bound force; created by RequestV2 CPI.
    #[account(mut)]
    pub randomness: UncheckedAccount<'info>,
    pub orao_program: Program<'info, OraoVrf>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ResolvePack<'info> {
    #[account(mut,seeds=[b"pack",pack.batch.as_ref(),&pack.index.to_le_bytes()],bump=pack.bump)]
    pub pack: Box<Account<'info, Pack>>,
    #[account(address=pack.manifest)]
    pub manifest: Box<Account<'info, Manifest>>,
    /// CHECK: PDA, owner, seed, client and full fulfillment all verified by handler.
    pub randomness: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct RefundPack<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,seeds=[b"pack",pack.batch.as_ref(),&pack.index.to_le_bytes()],bump=pack.bump)]
    pub pack: Box<Account<'info, Pack>>,
    #[account(address=USDC)]
    pub usdc: Box<Account<'info, Mint>>,
    #[account(mut,token::mint=usdc,token::authority=owner)]
    pub owner_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,associated_token::mint=usdc,associated_token::authority=pack)]
    pub pack_cash: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct SettlePack<'info> {
    pub solver: Signer<'info>,
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
    #[account(mut,token::mint=usdc,token::authority=solver)]
    pub solver_cash: Box<Account<'info, TokenAccount>>,
    #[account(mut,address=config.treasury,token::mint=usdc)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub stock_mint: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(mut,token::mint=stock_mint,token::authority=solver,token::token_program=stock_program)]
    pub solver_stock: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut,token::mint=stock_mint,token::token_program=stock_program,constraint=owner_stock.owner==pack.owner @ StockroomError::Unauthorized)]
    pub owner_stock: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    pub stock_program: Interface<'info, TokenInterface>,
    /// CHECK: Verified Pyth receiver account and fixed manifest feed ID.
    pub stock_price: UncheckedAccount<'info>,
    /// CHECK: Verified Pyth receiver account and fixed USDC feed ID.
    pub usdc_price: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct SettlePosition<'info> {
    pub base: ManagePosition<'info>,
    pub stock_mint: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(mut,token::mint=stock_mint,token::token_program=stock_program,constraint=solver_stock.owner==base.actor.key() @ StockroomError::Unauthorized)]
    pub solver_stock: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut,token::mint=stock_mint,token::token_program=stock_program,constraint=owner_stock.owner==base.position.owner @ StockroomError::Unauthorized)]
    pub owner_stock: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    pub stock_program: Interface<'info, TokenInterface>,
    /// CHECK: Verified Pyth receiver account and fixed manifest feed ID.
    pub stock_price: UncheckedAccount<'info>,
    /// CHECK: Verified Pyth receiver account and fixed USDC feed ID.
    pub usdc_price: UncheckedAccount<'info>,
    #[account(mut,token::mint=base.usdc,constraint=solver_cash.owner==base.actor.key() @ StockroomError::Unauthorized)]
    pub solver_cash: Box<Account<'info, TokenAccount>>,
}
