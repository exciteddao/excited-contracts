/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import type BigNumber from "bignumber.js";
import type { ContractOptions } from "web3-eth-contract";
import type { EventLog } from "web3-core";
import type { EventEmitter } from "events";
import type { Callback, PayableTransactionObject, NonPayableTransactionObject, BlockType, ContractEventLog, BaseContract } from "../../types";
export interface EventOptions {
  filter?: object;
  fromBlock?: BlockType;
  topics?: string[];
}
export type Activated = ContractEventLog<{}>;
export type AmountSet = ContractEventLog<{
  user: string;
  newAmount: string;
  oldAmount: string;
  0: string;
  1: string;
  2: string;
}>;
export type Claimed = ContractEventLog<{
  user: string;
  amount: string;
  isInitiatedByProject: boolean;
  0: string;
  1: string;
  2: boolean;
}>;
export type EmergencyClaimed = ContractEventLog<{
  user: string;
  amount: string;
  isInitiatedByProject: boolean;
  0: string;
  1: string;
  2: boolean;
}>;
export type EmergencyReleased = ContractEventLog<{}>;
export type EtherRecovered = ContractEventLog<{
  amount: string;
  0: string;
}>;
export type OwnershipTransferred = ContractEventLog<{
  previousOwner: string;
  newOwner: string;
  0: string;
  1: string;
}>;
export type ProjectRoleTransferred = ContractEventLog<{
  previousProjectWallet: string;
  newProjectWallet: string;
  0: string;
  1: string;
}>;
export type TokenRecovered = ContractEventLog<{
  token: string;
  amount: string;
  0: string;
  1: string;
}>;
export interface VestingV1 extends BaseContract {
  constructor(jsonInterface: any[], address?: string, options?: ContractOptions): VestingV1;
  clone(): VestingV1;
  methods: {
    MAX_START_TIME_FROM_NOW(): NonPayableTransactionObject<string>;

    MAX_VESTING_DURATION_SECONDS(): NonPayableTransactionObject<string>;

    PROJECT_TOKEN(): NonPayableTransactionObject<string>;

    VESTING_DURATION_SECONDS(): NonPayableTransactionObject<string>;

    activate(_vestingStartTime: number | string | BigNumber): NonPayableTransactionObject<void>;

    claim(user: string): NonPayableTransactionObject<void>;

    claimableFor(user: string): NonPayableTransactionObject<string>;

    emergencyClaim(user: string): NonPayableTransactionObject<void>;

    emergencyRelease(): NonPayableTransactionObject<void>;

    isActivated(): NonPayableTransactionObject<boolean>;

    isEmergencyReleased(): NonPayableTransactionObject<boolean>;

    isVestingStarted(): NonPayableTransactionObject<boolean>;

    owner(): NonPayableTransactionObject<string>;

    projectWallet(): NonPayableTransactionObject<string>;

    recoverEther(): NonPayableTransactionObject<void>;

    recoverToken(tokenAddress: string): NonPayableTransactionObject<void>;

    renounceOwnership(): NonPayableTransactionObject<void>;

    setAmount(user: string, newAmount: number | string | BigNumber): NonPayableTransactionObject<void>;

    totalAmount(): NonPayableTransactionObject<string>;

    totalClaimed(): NonPayableTransactionObject<string>;

    totalVestedFor(user: string): NonPayableTransactionObject<string>;

    transferOwnership(newOwner: string): NonPayableTransactionObject<void>;

    transferProjectRole(newProjectWallet: string): NonPayableTransactionObject<void>;

    userVestings(arg0: string): NonPayableTransactionObject<{
      amount: string;
      claimed: string;
      0: string;
      1: string;
    }>;

    vestingStartTime(): NonPayableTransactionObject<string>;
  };
  events: {
    Activated(cb?: Callback<Activated>): EventEmitter;
    Activated(options?: EventOptions, cb?: Callback<Activated>): EventEmitter;

    AmountSet(cb?: Callback<AmountSet>): EventEmitter;
    AmountSet(options?: EventOptions, cb?: Callback<AmountSet>): EventEmitter;

    Claimed(cb?: Callback<Claimed>): EventEmitter;
    Claimed(options?: EventOptions, cb?: Callback<Claimed>): EventEmitter;

    EmergencyClaimed(cb?: Callback<EmergencyClaimed>): EventEmitter;
    EmergencyClaimed(options?: EventOptions, cb?: Callback<EmergencyClaimed>): EventEmitter;

    EmergencyReleased(cb?: Callback<EmergencyReleased>): EventEmitter;
    EmergencyReleased(options?: EventOptions, cb?: Callback<EmergencyReleased>): EventEmitter;

    EtherRecovered(cb?: Callback<EtherRecovered>): EventEmitter;
    EtherRecovered(options?: EventOptions, cb?: Callback<EtherRecovered>): EventEmitter;

    OwnershipTransferred(cb?: Callback<OwnershipTransferred>): EventEmitter;
    OwnershipTransferred(options?: EventOptions, cb?: Callback<OwnershipTransferred>): EventEmitter;

    ProjectRoleTransferred(cb?: Callback<ProjectRoleTransferred>): EventEmitter;
    ProjectRoleTransferred(options?: EventOptions, cb?: Callback<ProjectRoleTransferred>): EventEmitter;

    TokenRecovered(cb?: Callback<TokenRecovered>): EventEmitter;
    TokenRecovered(options?: EventOptions, cb?: Callback<TokenRecovered>): EventEmitter;

    allEvents(options?: EventOptions, cb?: Callback<EventLog>): EventEmitter;
  };

  once(event: "Activated", cb: Callback<Activated>): void;
  once(event: "Activated", options: EventOptions, cb: Callback<Activated>): void;

  once(event: "AmountSet", cb: Callback<AmountSet>): void;
  once(event: "AmountSet", options: EventOptions, cb: Callback<AmountSet>): void;

  once(event: "Claimed", cb: Callback<Claimed>): void;
  once(event: "Claimed", options: EventOptions, cb: Callback<Claimed>): void;

  once(event: "EmergencyClaimed", cb: Callback<EmergencyClaimed>): void;
  once(event: "EmergencyClaimed", options: EventOptions, cb: Callback<EmergencyClaimed>): void;

  once(event: "EmergencyReleased", cb: Callback<EmergencyReleased>): void;
  once(event: "EmergencyReleased", options: EventOptions, cb: Callback<EmergencyReleased>): void;

  once(event: "EtherRecovered", cb: Callback<EtherRecovered>): void;
  once(event: "EtherRecovered", options: EventOptions, cb: Callback<EtherRecovered>): void;

  once(event: "OwnershipTransferred", cb: Callback<OwnershipTransferred>): void;
  once(event: "OwnershipTransferred", options: EventOptions, cb: Callback<OwnershipTransferred>): void;

  once(event: "ProjectRoleTransferred", cb: Callback<ProjectRoleTransferred>): void;
  once(event: "ProjectRoleTransferred", options: EventOptions, cb: Callback<ProjectRoleTransferred>): void;

  once(event: "TokenRecovered", cb: Callback<TokenRecovered>): void;
  once(event: "TokenRecovered", options: EventOptions, cb: Callback<TokenRecovered>): void;
}