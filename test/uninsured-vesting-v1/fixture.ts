import { Token, account, bn18, erc20, BlockInfo, web3, network } from "@defi.org/web3-candies";
import { deployArtifact, mineBlock, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { VestingV1 } from "../../typechain-hardhat/contracts/vesting-v1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { config } from "../../deployment/vesting-v1/config";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let anyUser: string;

export let projectToken: MockERC20 & Token;
export let someOtherToken: MockERC20 & Token;
export let vesting: VestingV1;

export const DAY = 60 * 60 * 24;
export const MONTH = DAY * 30;
export const VESTING_DURATION_SECONDS = DAY * 730;

export const PROJECT_TOKENS_ON_SALE = 1_000_000;
export const FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO = 7;
export const LOCKUP_MONTHS = 6;
export const TOKENS_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  anyUser = await account(1);
  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");
}

export async function withFixture() {
  projectToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "ProjectToken"])).options.address);
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);

  // TODO TEMPORARY: until having production PROJECT_TOKEN address
  const testConfig = [...config];
  testConfig[0] = projectToken.options.address;
  // END TEMPORARY

  vesting = await deployArtifact<VestingV1>("VestingV1", { from: deployer }, testConfig);
}

export enum Error {
  ZeroAddress = "ZeroAddress",
  StartTimeTooLate = "StartTimeTooLate",
  StartTimeIsInPast = "StartTimeIsInPast",
  VestingNotStarted = "VestingNotStarted",
  AlreadyActivated = "AlreadyActivated",
  NothingToClaim = "NothingToClaim",
  NoAllocationsAdded = "NoAllocationsAdded",
  OnlyOwnerOrSender = "OnlyOwnerOrSender",
}

export async function transferProjectTokenToVesting() {
  await projectToken.methods.transfer(vesting.options.address, await projectToken.amount(PROJECT_TOKENS_ON_SALE)).send({ from: deployer });
}

export async function approveProjectTokenToVesting(amount = PROJECT_TOKENS_ON_SALE) {
  await projectToken.methods.approve(vesting.options.address, await projectToken.amount(amount)).send({ from: deployer });
}

export function advanceDays(days: number): Promise<BlockInfo> {
  return mineBlock(days * DAY);
}

export function advanceMonths(months: number): Promise<BlockInfo> {
  return mineBlock(months * MONTH);
}

import { time } from "@nomicfoundation/hardhat-network-helpers";

// TODO export to utils and use across multiple contracts
export async function getCurrentTimestamp(): Promise<string | number | BN> {
  // Plus 1 - we are passing a timestamp the contract that's supposed to act as "now"
  // when the transaction actually executes, it's going to be 1 second later
  // TODO - consider whether this is viable/stable
  return BN(await time.latest()).plus(1);
}

export async function getDefaultStartTime(): Promise<BN> {
  return BN(await getCurrentTimestamp()).plus(DAY * 3);
}

export async function setAmountForUser1(amount = TOKENS_PER_USER) {
  await vesting.methods.setAmount(user1, await projectToken.amount(amount)).send({ from: deployer });
}

export async function setAmountForUser2(amount = TOKENS_PER_USER) {
  await vesting.methods.setAmount(user2, await projectToken.amount(amount)).send({ from: deployer });
}

export async function vestedAmount(days: number) {
  let amount = BN(TOKENS_PER_USER)
    .dividedBy(VESTING_DURATION_SECONDS)
    .multipliedBy(DAY * days);
  return projectToken.amount(amount);
}

export async function activateAndReachStartTime() {
  await vesting.methods.activate(await getDefaultStartTime()).send({ from: deployer });
  await advanceDays(3);
}
