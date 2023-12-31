import { expect, assert } from "chai";
import { withFixture, setup, vesting } from "./fixture";
import BN from "bignumber.js";
import sinon from "sinon";

import { zeroAddress } from "@defi.org/web3-candies";
import { ConfigTuple, deployVestingV1 } from "../../deployment/vesting-v1";

describe("VestingV1 deployment config", () => {
  before(async () => await setup());

  beforeEach(async () => withFixture());

  // TODO: reenable this when config is using real XCTD address
  it.skip("xctd address cannot be zero", async () => {
    expect((await vesting.methods.PROJECT_TOKEN().call()).toLowerCase()).to.not.match(/^0x0+$/);
  });

  it("duration is 2 years", async () => {
    expect(await vesting.methods.VESTING_DURATION_SECONDS().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
  });

  // TODO: reenable this when config is using real project wallet address
  it.skip("project wallet address cannot be zero", async () => {
    expect((await vesting.methods.projectWallet().call()).toLowerCase()).to.not.match(/^0x0+$/);
  });
});

describe("VestingV1 deployment script", () => {
  const web3CandiesStub = {
    deploy: sinon.stub(),
  };

  beforeEach(() => {
    web3CandiesStub.deploy.reset();
  });

  describe("Error handling", () => {
    const walletAddress = "0xc0ffee254729296a45a3885639AC7E10F9d54979";

    const testCases: { config: ConfigTuple; errorMessage: string }[] = [
      { config: [zeroAddress, 1, walletAddress], errorMessage: "XCTD address cannot be zero" },
      { config: ["Ox123", 10, walletAddress], errorMessage: "Duration must be 2 years" },
      { config: [walletAddress, 63_072_000, zeroAddress], errorMessage: "Project wallet address cannot be zero" },
    ];

    for (const { config, errorMessage } of testCases) {
      it(errorMessage, async () => {
        try {
          await deployVestingV1(web3CandiesStub.deploy, config, new BN(10), new BN(10));
          assert.fail("should have thrown error");
        } catch (error: any) {
          expect(error.message).to.equal(errorMessage);
        }
      });
    }
  });

  describe("Success", () => {
    it("should deploy", async () => {
      await deployVestingV1(web3CandiesStub.deploy, ["0x123", 63_072_000, "0x123"], new BN(10), new BN(10));
      expect(web3CandiesStub.deploy.calledOnce).to.be.true;
      expect(web3CandiesStub.deploy.firstCall.args[0]).to.deep.equal({
        contractName: "VestingV1",
        args: ["0x123", 63_072_000, "0x123"],
        maxFeePerGas: new BN(10),
        maxPriorityFeePerGas: new BN(10),
      });
    });
  });
});
