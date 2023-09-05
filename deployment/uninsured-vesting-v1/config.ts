import { zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  xctdAddress: string;
  durationSeconds: number;
}

export const _config: Config = {
  // TODO: replace with real address
  xctdAddress: zeroAddress,
  durationSeconds: 60 * 60 * 24 * 365 * 2,
};

export type ConfigTuple = [string, number];
