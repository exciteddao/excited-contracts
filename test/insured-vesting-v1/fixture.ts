import { Token, account, bn18, erc20, BlockInfo, Receipt, web3, bn6, ether } from "@defi.org/web3-candies";
import { deployArtifact, impersonate, mineBlock, setBalance, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { expect } from "chai";

import { config } from "../../deployment/insured-vesting-v1";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let additionalUsers: string[] = [];
export let anyUser: string;
export let project: string;

export let xctd: Token;
export let usdc: Token;
export let someOtherToken: MockERC20 & Token;
export let insuredVesting: InsuredVestingV1;

export const DAY = 60 * 60 * 24;
export const MONTH = DAY * 30;

export const XCTD_TOKENS_ON_SALE = 1_000_000;
export const USDC_TO_XCTD_RATIO = 7;
export const VESTING_DURATION_DAYS = 730;
export const VESTING_DURATION_SECONDS = DAY * VESTING_DURATION_DAYS;
export const LOCKUP_MONTHS = 6;
export const FUNDING_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  project = await account(4);
  anyUser = await account(1);
  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");
}

export enum Event {
  ProjectAddressChanged = "ProjectAddressChanged",
}

export enum Error {
  ZeroAddress = "ZeroAddress",
  VestingAlreadyStarted = "VestingAlreadyStarted",
  VestingNotStarted = "VestingNotStarted",
  StartTimeTooSoon = "StartTimeTooSoon",
  StartTimeNotInFuture = "StartTimeNotInFuture",
  AllocationExceeded = "AllocationExceeded",
  NothingToClaim = "NothingToClaim",
  NoFundsAdded = "NoFundsAdded",
  EmergencyReleased = "EmergencyReleased",
  EmergencyNotReleased = "EmergencyNotReleased",
  OnlyOwnerOrSender = "OnlyOwnerOrSender",
}

export async function withFixture() {
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);
  xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);

  // TODO TEMPORARY: until having production XCTD & project addresses
  const testConfig = [...config];
  testConfig[1] = xctd.options.address;
  testConfig[2] = project;
  // END TEMPORARY

  insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
  usdc = erc20("USDC", await insuredVesting.methods.USDC().call());

  await fundUsdcFromWhale(BN(10_000_000));

  for (const target of [user1, user2].concat(additionalUsers)) {
    await usdc.methods.approve(insuredVesting.options.address, await usdc.amount(FUNDING_PER_USER)).send({ from: target });
  }

  await xctd.methods.transfer(project, bn18(1e9)).send({ from: deployer });
  await xctd.methods.approve(project, bn18(1e9)).send({ from: deployer });
}

export async function transferXctdToVesting(amount = XCTD_TOKENS_ON_SALE) {
  await xctd.methods.transfer(insuredVesting.options.address, await xctd.amount(amount)).send({ from: project });
}

export async function approveXctdToVesting(amount = XCTD_TOKENS_ON_SALE) {
  await xctd.methods.approve(insuredVesting.options.address, await xctd.amount(amount)).send({ from: project });
}

export function advanceDays(days: number): Promise<BlockInfo> {
  return mineBlock(days * DAY);
}

export function advanceMonths(months: number): Promise<BlockInfo> {
  return mineBlock(months * MONTH);
}

export async function getCurrentTimestamp(): Promise<string | number | BN> {
  return (await web3().eth.getBlock("latest")).timestamp;
}

export async function getDefaultStartTime(): Promise<BN> {
  return await BN(await getCurrentTimestamp()).plus(MONTH * 6);
}

export function usdcToXctd(amountInUsdc: BN): BN {
  const xctdDecimals = 18;
  const multiplier = USDC_TO_XCTD_RATIO * 10 ** xctdDecimals;
  return amountInUsdc.multipliedBy(multiplier);
}

export async function addFundingFromUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addFunds(await usdc.amount(amount)).send({ from: user1 });
}

export async function setAllocationForUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.setAllocation(user1, await usdc.amount(amount)).send({ from: deployer });
}

export async function addFundingFromUser2(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addFunds(await usdc.amount(amount)).send({ from: user2 });
}

export async function setAllocationForUser2(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.setAllocation(user2, await usdc.amount(amount)).send({ from: deployer });
}

export const balances = {
  project: {
    xctd: BN(-1),
    usdc: BN(-1),
  },
  user1: {
    xctd: BN(-1),
    usdc: BN(-1),
  },
};

export async function setBalancesForDelta() {
  balances.user1.usdc = BN(await usdc.methods.balanceOf(user1).call());
  balances.user1.xctd = BN(await xctd.methods.balanceOf(user1).call());
  balances.project.usdc = BN(await usdc.methods.balanceOf(project).call());
  balances.project.xctd = BN(await xctd.methods.balanceOf(project).call());
}

export async function vestedAmount(days: number, token: "usdc" | "xctd") {
  let amount = BN(FUNDING_PER_USER)
    .dividedBy(VESTING_DURATION_SECONDS)
    .multipliedBy(DAY * days);
  if (token === "xctd") {
    return xctd.amount(amount.multipliedBy(USDC_TO_XCTD_RATIO));
  } else {
    return usdc.amount(amount);
  }
}

export async function expectBalanceDelta(target: "project" | "user1", token: "usdc" | "xctd", expectedDelta: BN | number, closeTo: number) {
  const _token = token === "xctd" ? xctd : usdc;
  const amount = BN(await _token.methods.balanceOf(target === "user1" ? user1 : project).call());
  return expect(amount.minus(balances[target][token])).to.bignumber.closeTo(expectedDelta, await _token.amount(closeTo));
}

export async function expectUserBalanceDelta(token: "usdc" | "xctd", expectedDelta: BN | number, closeTo: number = 0.1) {
  return expectBalanceDelta("user1", token, expectedDelta, closeTo);
}

export async function expectProjectBalanceDelta(token: "usdc" | "xctd", expectedDelta: BN | number, closeTo: number = 0.1) {
  return expectBalanceDelta("project", token, expectedDelta, closeTo);
}

export async function fundUsdcFromWhale(amount: BN, users: string[] = [user1, user2]) {
  const whale = "0x0a59649758aa4d66e25f08dd01271e891fe52199";
  tag(whale, "usdcTokenWhale");
  await impersonate(whale);
  await setBalance(whale, ether.times(100));

  expect(await usdc.methods.balanceOf(whale).call()).bignumber.gte(await usdc.amount(amount));

  for (const target of [user1, user2].concat(additionalUsers)) {
    await usdc.methods.transfer(target, await usdc.amount(FUNDING_PER_USER)).send({ from: whale });
    expect(await usdc.methods.balanceOf(target).call()).bignumber.eq(await usdc.amount(FUNDING_PER_USER));
  }
}
