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
      <Container maxW="6xl">
        <Heading as="h1" size="xl" noOfLines={1} mb={4} p={2}>
          Excited Contracts
        </Heading>
        <VestingContract contract={vestingContract} />
      </Container>
    </main>
  );
}

export default App;
