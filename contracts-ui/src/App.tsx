import { useForm } from "react-hook-form";
import { Contract } from "./Contract";
import { Box, Container, Flex, HStack, Heading, Input, Select } from "@chakra-ui/react";
import { ConnectWallet } from "@thirdweb-dev/react";
import { ThirdwebProvider } from "@thirdweb-dev/react";

function App() {
  const methods = useForm({
    defaultValues: {
      network: "polygon",
      address: "",
    },
  });

  const network = methods.watch("network");
  const address = methods.watch("address");

  return (
    <ThirdwebProvider activeChain={network} clientId="d6f3b57bca18be5fa614e237378ea1ff">
      <main>
        <Container maxW="6xl">
          <HStack spacing={4} mb={4} justifyContent="space-between">
            <Heading as="h1" size="xl" noOfLines={1} mb={4} p={2}>
              Excited Contracts
            </Heading>
            <ConnectWallet />
          </HStack>
          <form>
            <Flex gap={4}>
              <Select {...methods.register("network")} placeholder="Select a network">
                <option value="polygon">Polygon</option>
                <option value="ethereum">Ethereum</option>
              </Select>

              <Input type="text" {...methods.register("address")} placeholder="Contract address" />
            </Flex>
          </form>
          <Box pt={4}>{address && <Contract address={address} />}</Box>
        </Container>
      </main>
    </ThirdwebProvider>
  );
}

export default App;
