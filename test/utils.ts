import BN from "bignumber.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BlockInfo } from "@defi.org/web3-candies";
import { mineBlock } from "@defi.org/web3-candies/dist/hardhat";

export const DAY_SECONDS = 60 * 60 * 24;
export const MONTH_SECONDS = DAY_SECONDS * 30;

// TODO export to utils and use across multiple contracts
export async function getCurrentTimestamp(): Promise<string | number | BN> {
  // Plus 1 - we are passing a timestamp the contract that's supposed to act as "now"
  // when the transaction actually executes, it's going to be 1 second later
  // TODO - consider whether this is viable/stable
  return BN(await time.latest()).plus(1);
}

export function advanceDays(days: number): Promise<BlockInfo> {
  return mineBlock(days * DAY_SECONDS);
}

export function advanceMonths(months: number): Promise<BlockInfo> {
  return mineBlock(months * MONTH_SECONDS);
}
