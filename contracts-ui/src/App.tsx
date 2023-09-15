import { QueryClient, QueryClientProvider } from "react-query";
import { VestingContract } from "./VestingContract";
import Web3 from "web3";
import { AppConfig } from "./config";
import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { VestingV1 } from "./generated/contracts/vesting-v1/VestingV1";

const queryClient = new QueryClient();
const web3 = new Web3(AppConfig.Polygon.Mainnet.RpcUrl);
const vestingContract = new web3.eth.Contract(VestingAbi.abi, AppConfig.Polygon.Mainnet.VestingV1ContractAddress) as unknown as VestingV1;

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <h1>Excited Contracts</h1>
      <div>
        <VestingContract contract={vestingContract} />
      </div>
    </QueryClientProvider>
  );
}

export default App;
