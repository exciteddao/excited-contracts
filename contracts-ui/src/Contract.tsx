import {
  Accordion,
  VStack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Alert,
  AlertIcon,
  Spinner,
  Table,
  TableContainer,
  Tbody,
  Td,
  Tr,
  Code,
} from "@chakra-ui/react";
import { CodeDisplay, FunctionAccordionItem } from "./components";
import { ContractEvent, useContract } from "@thirdweb-dev/react";
import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { useEffect, useState } from "react";

type ContractProps = {
  address: string;
};

export function Contract({ address }: ContractProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [events, setEvents] = useState<ContractEvent<Record<string, any>>[]>([]);
  const { contract, isLoading, error } = useContract(address);

  useEffect(() => {
    if (!contract) {
      return;
    }

    if (events.length === 0) {
      contract.events.getAllEvents().then((events) => {
        console.log("all events", events);
        setEvents((prev) => [...prev, ...events]);
      });
    }

    contract.events.listenToAllEvents((event) => {
      console.log("new event", event);
      setEvents((prev) => [...prev, event]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  let errorMessage = "Contract failed to load";

  if (error instanceof Error) {
    errorMessage = error.message;
  }

  if (isLoading) {
    return <Spinner />;
  }

  if (!contract) {
    return (
      <Alert status="error">
        <AlertIcon />
        {errorMessage}
      </Alert>
    );
  }

  const functions = contract.abi.filter((abi) => abi.type === "function");
  const readFunctions = [];
  const writeFunctions = [];

  for (const func of functions) {
    if (func.stateMutability === "view" || func.stateMutability === "pure") {
      readFunctions.push(func);
    } else {
      writeFunctions.push(func);
    }
  }

  const errors = contract.abi.filter((abi) => abi.type === "error") || [];
  const constructor = contract.abi.filter((abi) => abi.type === "constructor") || [];

  return (
    <Tabs>
      <TabList>
        <Tab>Read</Tab>
        <Tab>Write</Tab>
        <Tab>Events</Tab>
        <Tab>Errors</Tab>
        <Tab>Constructor</Tab>
      </TabList>

      <TabPanels>
        <TabPanel>
          <Accordion allowToggle>
            {readFunctions.map((abi, index) => (
              <FunctionAccordionItem key={`read-${index}`} contract={contract} abi={abi as (typeof VestingAbi.abi)[number]} />
            ))}
          </Accordion>
        </TabPanel>
        <TabPanel>
          <VStack alignItems="flex-start" spacing={4}>
            <Accordion allowToggle width="100%">
              {writeFunctions.map((abi, index) => (
                <FunctionAccordionItem key={`write-${index}`} contract={contract} abi={abi as (typeof VestingAbi.abi)[number]} />
              ))}
            </Accordion>
          </VStack>
        </TabPanel>
        <TabPanel>
          <TableContainer>
            <Table variant="simple">
              <Tbody>
                {events.map((event, index) => (
                  <Tr key={`event=${index}`}>
                    <Td>
                      {event.transaction.transactionHash}
                      <br />
                      {event.transaction.blockNumber}
                    </Td>
                    <Td>
                      <strong>{event.eventName}</strong>
                      <br />
                      <Code p={4}>
                        {Object.entries(event.data).map(([key, value]) => (
                          <span key={key}>
                            {`${key}`}: {`${value}`}
                            <br />
                          </span>
                        ))}
                      </Code>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </TabPanel>
        <TabPanel>
          <VStack alignItems="flex-start">
            {errors.map((abi, index) => (
              <CodeDisplay key={`errors-${index}`} type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
            ))}
          </VStack>
        </TabPanel>
        <TabPanel>
          <VStack alignItems="flex-start">
            {constructor.map((abi, index) => (
              <CodeDisplay key={`contructor-${index}`} type={abi.type} name={abi.name} inputs={abi.inputs} outputs={abi.outputs} />
            ))}
          </VStack>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
