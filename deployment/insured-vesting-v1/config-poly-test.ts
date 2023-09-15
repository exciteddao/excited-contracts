import BN from "bignumber.js";
import { bn18, bn6, zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  usdcAddress: string;
  xctdAddress: string;
  durationSeconds: number;
  fundingTokenAmountIn: BN;
  projectTokenAmountOut: BN;
  projectWalletAddress: string;
}

const USDC_DECIMALS = 1e6;
const XCTD_DECIMALS = 1e18;
const STRIKE_PRICE = 0.2; // 0.2$ per XCTD

export const _config: Config = {
  usdcAddress: "0xA24a0C753f14128B500D79d9D5cAb6f4195f9f36",
  // TODO: replace with real address
  xctdAddress: "0xb49d92F90eD85Be05b0e114cb11D2ea48607F2e8",
  durationSeconds: 60 * 60 * 24,
  fundingTokenAmountIn: BN(STRIKE_PRICE).multipliedBy(USDC_DECIMALS),
  projectTokenAmountOut: BN(XCTD_DECIMALS),
  // TODO: replace with real address
  projectWalletAddress: "0xC1760d11bb342EBCD4fbE30f3c673558dE1DBd2c",
};

export type ConfigTuple = [string, string, number, BN, BN, string];

export const config: ConfigTuple = [
  _config.usdcAddress,
  _config.xctdAddress,
  _config.durationSeconds,
  _config.fundingTokenAmountIn,
  _config.projectTokenAmountOut,
  _config.projectWalletAddress,
];
