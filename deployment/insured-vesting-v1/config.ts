import BN from "bignumber.js";
import { bn18, bn6, zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  usdcAddress: string;
  xctdAddress: string;
  projectAddress: string;
  usdcToXctdRate: BN;
  durationSeconds: number;
}

export const _config: Config = {
  usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  // TODO: replace with real address
  projectAddress: zeroAddress,
  usdcToXctdRate: bn18(7).dividedBy(bn6(1)), // Reflects 1 USDC = 7 XCTD, based on Ethereum's USDC having 6 decimals and XCTD having 18 decimals
  durationSeconds: 60 * 60 * 24 * 365 * 2,
};

export type ConfigTuple = [string, string, string, BN, number];
