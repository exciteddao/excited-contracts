import { VestingContract } from "./VestingContract";
import Web3 from "web3";
import { AppConfig } from "./config";
import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { VestingV1 } from "./generated/contracts/vesting-v1/VestingV1";
import { Container, Heading } from "@chakra-ui/react";

const web3 = new Web3(AppConfig.Polygon.Mainnet.RpcUrl);
const vestingContract = new web3.eth.Contract(VestingAbi.abi, AppConfig.Polygon.Mainnet.VestingV1ContractAddress) as unknown as VestingV1;

function App() {
  return (
    <main>
      <Heading as="h1" size="2xl" noOfLines={1}>
        Excited Contracts
      </Heading>
      <Container maxW="4xl">
        <VestingContract contract={vestingContract} />
      </Container>
    </main>
  );
}

export default App;
