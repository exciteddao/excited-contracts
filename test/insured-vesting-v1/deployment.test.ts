import { assert, expect } from "chai";

import { deployInsuredVestingV1, ConfigTuple } from "../../deployment/insured-vesting-v1";
import sinon from "sinon";

import BN from "bignumber.js";
import { config } from "../../deployment/insured-vesting-v1";
import { deployArtifact } from "@defi.org/web3-candies/dist/hardhat";
import { MockERC20 } from "../../typechain-hardhat/contracts/test/MockERC20";
import { InsuredVestingV1 } from "../../typechain-hardhat/contracts/insured-vesting-v1/InsuredVestingV1";

import { setup } from "./fixture";
import { erc20, bn18, Token, account, bn6, zeroAddress } from "@defi.org/web3-candies";

describe("InsuredVestingV1 deployment config", () => {
  before(async () => await setup());

  let insuredVesting: InsuredVestingV1;
  let xctd: Token;
  let deployer: string;

  describe("InsuredVestingV1 deployment", () => {
    before(async () => {
      deployer = await account(9);
      xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);

      // TODO TEMPORARY: until having production XCTD & project addresses
      const testConfig = [...config];
      testConfig[1] = xctd.options.address;
      testConfig[2] = await account(4);
      // END TEMPORARY

      insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
    });

    describe("InsuredVestingV1 deployment", () => {
      before(async () => {
        deployer = await account(9);
        xctd = erc20("MockERC20", (await deployArtifact<MockERC20>("MockERC20", { from: deployer }, [bn18(1e9), "XCTD"])).options.address);

        // TODO TEMPORARY: until having production XCTD & project addresses
        const testConfig = [...config];
        testConfig[1] = xctd.options.address;
        testConfig[2] = await account(4);
        // END TEMPORARY

        insuredVesting = await deployArtifact<InsuredVestingV1>("InsuredVestingV1", { from: deployer }, testConfig);
      });

      it("xctd address cannot be zero", async () => {
        const xctd = await insuredVesting.methods.XCTD().call();
        expect(xctd.toLowerCase()).to.not.match(/^0x0+$/);
      });

      it("xctd must have 18 decimals", async () => {
        const xctd = await insuredVesting.methods.XCTD().call();
        expect(await erc20("XCTD", xctd).decimals()).to.equal(18);
      });

      it("usdc address cannot be zero", async () => {
        const usdc = await insuredVesting.methods.USDC().call();
        expect(usdc.toLowerCase()).to.not.match(/^0x0+$/);
      });

      it("usdc must have 6 decimals", async () => {
        const usdc = await insuredVesting.methods.USDC().call();
        expect(await erc20("USDC", usdc).decimals()).to.equal(6);
      });

      it("project address cannot be zero", async () => {
        const project = await insuredVesting.methods.project().call();
        expect(project.toLowerCase()).to.not.match(/^0x0+$/);
      });

      // TODO define this amount
      it.skip("project xctd balance must be over [TODO]", async () => {
        const project = await insuredVesting.methods.project().call();
        const xctd = erc20("XCTD", await insuredVesting.methods.XCTD().call());
        expect(await xctd.methods.balanceOf(project).call()).to.be.bignumber.greaterThan(await xctd.amount(999_999_999));
      });

      it("usdc to xctd rate must be at least 1:1", async () => {
        const usdcToXctdRate = BN(await insuredVesting.methods.USDC_TO_XCTD_RATE().call());
        expect(usdcToXctdRate).to.be.bignumber.gte(1e12);
      });

      it("duration is 2 years", async () => {
        expect(await insuredVesting.methods.VESTING_DURATION().call()).to.equal(String(60 * 60 * 24 * 365 * 2));
      });
    });

    describe("InsuredVestingV1 deployment script", () => {
      const web3CandiesStub = {
        deploy: sinon.stub(),
      };

      beforeEach(() => {
        web3CandiesStub.deploy.reset();
      });

      const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
      const randomEthAddress = "0xc0ffee254729296a45a3885639AC7E10F9d54979";
      const usdcToXctdRate = bn18(7).dividedBy(bn6(1));
      const durationSeconds = 60 * 60 * 24 * 365 * 2;

      describe("Error handling", () => {
        const testCases: { config: ConfigTuple; errorMessage: string }[] = [
          { config: [randomEthAddress, randomEthAddress, randomEthAddress, usdcToXctdRate, durationSeconds], errorMessage: "Wrong USDC address" },
          { config: [usdcAddress, zeroAddress, randomEthAddress, usdcToXctdRate, durationSeconds], errorMessage: "XCTD address cannot be zero" },
          { config: [usdcAddress, randomEthAddress, zeroAddress, usdcToXctdRate, durationSeconds], errorMessage: "Project address cannot be zero" },
          { config: [usdcAddress, randomEthAddress, randomEthAddress, bn18(), durationSeconds], errorMessage: "Wrong USDC to XCTD rate" },
          { config: [usdcAddress, randomEthAddress, randomEthAddress, usdcToXctdRate, 10000], errorMessage: "Wrong vesting duration" },
        ];

        for (const { config, errorMessage } of testCases) {
          it(errorMessage, async () => {
            try {
              await deployInsuredVestingV1(web3CandiesStub.deploy, config, new BN(10), new BN(10));
              assert.fail("should have thrown error");
            } catch (error: any) {
              expect(error.message).to.equal(errorMessage);
            }
          });
        }
      });

      describe("Success", () => {
        it("should deploy", async () => {
          await deployInsuredVestingV1(
            web3CandiesStub.deploy,
            [usdcAddress, randomEthAddress, randomEthAddress, usdcToXctdRate, durationSeconds],
            new BN(10),
            new BN(10)
          );
          expect(web3CandiesStub.deploy.calledOnce).to.be.true;
          expect(web3CandiesStub.deploy.firstCall.args[0]).to.deep.equal({
            contractName: "InsuredVestingV1",
            args: [usdcAddress, randomEthAddress, randomEthAddress, usdcToXctdRate, durationSeconds],
            maxFeePerGas: new BN(10),
            maxPriorityFeePerGas: new BN(10),
          });
        });
      });
    });
  });
});
