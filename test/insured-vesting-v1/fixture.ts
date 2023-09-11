import { Token, account, bn18, erc20, ether } from "@defi.org/web3-candies";
import { deployArtifact, impersonate, setBalance, tag, useChaiBigNumber } from "@defi.org/web3-candies/dist/hardhat";
import BN from "bignumber.js";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { expect } from "chai";

import { config } from "../../deployment/insured-vesting-v1";
import { DAY, advanceDays, getCurrentTimestamp } from "../utils";

useChaiBigNumber();

export let deployer: string;
export let user1: string;
export let user2: string;
export let additionalUsers: string[] = [];
export let anyUser: string;
export let projectWallet: string;
export let differentProjectWallet: string;

export let projectToken: Token;
export let fundingToken: Token;
export let someOtherToken: MockERC20 & Token;
export let insuredVesting: InsuredVestingV1;

export const PROJECT_TOKENS_ON_SALE = 1_000_000;
export const FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO = 5; // TODO do we want to modify this to be the other way around as well
export const VESTING_DURATION_DAYS = 730;
export const VESTING_DURATION_SECONDS = DAY * VESTING_DURATION_DAYS;
export const LOCKUP_MONTHS = 6;
export const FUNDING_PER_USER = 10_000;

export async function setup() {
  deployer = await account(9);
  user1 = await account(0);
  user2 = await account(3);
  anyUser = await account(1);
  projectWallet = await account(5);
  differentProjectWallet = await account(6);

  tag(deployer, "deployer");
  tag(user1, "user1");
  tag(user2, "user2");
  tag(anyUser, "anyUser");
  tag(projectWallet, "projectWallet");
  tag(differentProjectWallet, "differentProjectWallet");
}

export enum Event {
  ProjectWalletAddressChanged = "ProjectWalletAddressChanged",
  ProjectRoleTransferred = "ProjectRoleTransferred",
}

export enum Error {
  ZeroAddress = "ZeroAddress",
  SameAddress = "SameAddress",
  VestingDurationTooLong = "VestingDurationTooLong",
  StartTimeTooDistant = "StartTimeTooDistant",
  StartTimeInPast = "StartTimeInPast",
  VestingNotStarted = "VestingNotStarted",
  AllocationExceeded = "AllocationExceeded",
  NothingToClaim = "NothingToClaim",
  NoFundsAdded = "NoFundsAdded",
  EmergencyReleased = "EmergencyReleased",
  EmergencyNotReleased = "EmergencyNotReleased",
  OnlyProjectOrSender = "OnlyProjectOrSender",
  AlreadyActivated = "AlreadyActivated",
}

export async function withFixture() {
  projectToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: projectWallet }, [bn18(1e9), "ProjectToken"])).options.address);
  someOtherToken = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "SomeOtherToken"])).options.address);

  // TODO TEMPORARY: until having production project token address & project wallet address
  const testConfig = [...config];
  testConfig[1] = projectToken.options.address;
  testConfig[2] = projectWallet;
  // END TEMPORARY

  insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
  fundingToken = erc20("fundingToken", await insuredVesting.methods.FUNDING_TOKEN().call());

  additionalUsers = [];
  for (let i = 1; i <= 6; i++) {
    additionalUsers.push(await account(i + 10));
    tag(additionalUsers[i], "additionalUser" + i);
  }

  await fundFundingTokenFromWhale(BN(FUNDING_PER_USER), [user1, user2].concat(additionalUsers));

  for (const target of [user1, user2].concat(additionalUsers)) {
    await fundingToken.methods.approve(insuredVesting.options.address, await fundingToken.amount(FUNDING_PER_USER)).send({ from: target });
  }

  await projectToken.methods.transfer(projectWallet, bn18(1e9)).send({ from: projectWallet });
  await projectToken.methods.approve(projectWallet, bn18(1e9)).send({ from: projectWallet });
}

export async function transferProjectTokenToVesting(amount = PROJECT_TOKENS_ON_SALE) {
  await projectToken.methods.transfer(insuredVesting.options.address, await projectToken.amount(amount)).send({ from: projectWallet });
}

export async function approveProjectTokenToVesting(amount = PROJECT_TOKENS_ON_SALE) {
  await projectToken.methods.approve(insuredVesting.options.address, await projectToken.amount(amount)).send({ from: projectWallet });
}

export async function getDefaultStartTime(): Promise<BN> {
  return BN(await getCurrentTimestamp()).plus(DAY * 3);
}

export function fundingTokenToProjectToken(amountInFundingToken: BN): BN {
  const projectTokenDecimals = 18;
  const multiplier = FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO * 10 ** projectTokenDecimals;
  return amountInFundingToken.multipliedBy(multiplier);
}

export async function addFundingFromUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addFunds(await fundingToken.amount(amount)).send({ from: user1 });
}

export async function setAllocationForUser1(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.setAllocation(user1, await fundingToken.amount(amount)).send({ from: projectWallet });
}

export async function addFundingFromUser2(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.addFunds(await fundingToken.amount(amount)).send({ from: user2 });
}

export async function setAllocationForUser2(amount = FUNDING_PER_USER) {
  await insuredVesting.methods.setAllocation(user2, await fundingToken.amount(amount)).send({ from: projectWallet });
}

export const balances = {
  project: {
    projectToken: BN(-1),
    fundingToken: BN(-1),
  },
  user1: {
    projectToken: BN(-1),
    fundingToken: BN(-1),
  },
};

export async function setBalancesForDelta() {
  balances.user1.fundingToken = BN(await fundingToken.methods.balanceOf(user1).call());
  balances.user1.projectToken = BN(await projectToken.methods.balanceOf(user1).call());
  balances.project.fundingToken = BN(await fundingToken.methods.balanceOf(projectWallet).call());
  balances.project.projectToken = BN(await projectToken.methods.balanceOf(projectWallet).call());
}

export async function vestedAmount(days: number, token: "fundingToken" | "projectToken") {
  let amount = BN(FUNDING_PER_USER)
    .dividedBy(VESTING_DURATION_SECONDS)
    .multipliedBy(DAY * days);
  if (token === "projectToken") {
    return projectToken.amount(amount.multipliedBy(FUNDING_TOKEN_TO_PROJECT_TOKEN_RATIO));
  } else {
    return fundingToken.amount(amount);
  }
}

export async function expectBalanceDelta(target: "project" | "user1", token: "fundingToken" | "projectToken", expectedDelta: BN | number, closeTo: number) {
  const _token = token === "projectToken" ? projectToken : fundingToken;
  const amount = BN(await _token.methods.balanceOf(target === "user1" ? user1 : projectWallet).call());
  return expect(amount.minus(balances[target][token])).to.bignumber.closeTo(expectedDelta, await _token.amount(closeTo));
}

export async function expectUserBalanceDelta(token: "fundingToken" | "projectToken", expectedDelta: BN | number, closeTo: number = 0.1) {
  return expectBalanceDelta("user1", token, expectedDelta, closeTo);
}

export async function expectProjectBalanceDelta(token: "fundingToken" | "projectToken", expectedDelta: BN | number, closeTo: number = 0.1) {
  return expectBalanceDelta("project", token, expectedDelta, closeTo);
}

export async function fundFundingTokenFromWhale(amount: BN, targets: string[]) {
  const whale = "0x0a59649758aa4d66e25f08dd01271e891fe52199";
  tag(whale, "fundingTokenTokenWhale");
  await impersonate(whale);
  await setBalance(whale, ether.times(10000));

  expect(await fundingToken.methods.balanceOf(whale).call()).bignumber.gte(await fundingToken.amount(amount.multipliedBy(targets.length)));

  for (const target of targets) {
    const initialBalance = await fundingToken.methods.balanceOf(target).call();
    await fundingToken.methods.transfer(target, await fundingToken.amount(amount)).send({ from: whale });
    expect(BN(await fundingToken.methods.balanceOf(target).call()).minus(initialBalance)).bignumber.eq(await fundingToken.amount(amount));
  }
}

export async function activateAndReachStartTime() {
  await insuredVesting.methods.activate(await getDefaultStartTime()).send({ from: projectWallet });
  await advanceDays(3);
}
