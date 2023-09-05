import { expect, assert } from "chai";
import { withFixture, setup, uninsuredVesting } from "./fixture";
import BN from "bignumber.js";
import sinon from "sinon";

import { deployUninsuredVestingV1, _config } from "../../deployment/uninsured-vesting-v1";

describe("UninsuredVestingV1 deployment config", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

  // TODO: reenable this when config is using real XCTD address
  it.skip("xctd address cannot be zero", async () => {
    expect((await uninsuredVesting.methods.XCTD().call()).toLowerCase()).to.not.match(/^0x0+$/);
  });

  it("duration is 2 years", async () => {
    expect(await uninsuredVesting.methods.DURATION().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
  });
});

describe("UninsuredVestingV1 deployment script", () => {
  const web3CandiesStub = {
    deploy: sinon.stub(),
  };

  it("should deploy with correct contract name and arguments", async () => {
    await deployUninsuredVestingV1(web3CandiesStub.deploy, new BN(10), new BN(10));
    expect(web3CandiesStub.deploy.calledOnce).to.be.true;
    expect(web3CandiesStub.deploy.firstCall.args[0]).to.deep.equal({
      contractName: "UninsuredVestingV1",
      args: [_config.xctdAddress, _config.durationSeconds],
      maxFeePerGas: new BN(10),
      maxPriorityFeePerGas: new BN(10),
    });
  });
});
