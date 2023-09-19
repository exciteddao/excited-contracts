import { Spinner, TableContainer, Table, Tbody, Tr, Td, Code, Box } from "@chakra-ui/react";
import { ContractEvent, SmartContract } from "@thirdweb-dev/react";
import { useEffect, useState } from "react";

type EventsProps = {
  contract: SmartContract | undefined;
};

export function Events({ contract }: EventsProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [events, setEvents] = useState(new Map<string, ContractEvent<Record<string, any>>>());
  const [isEventsLoading, setIsEventsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!contract) {
      return;
    }

    if (events.size === 0) {
      setIsEventsLoading(true);
      contract.events.getAllEvents().then((events) => {
        events.forEach((event) => {
          setEvents((prev) => new Map(prev.set(`${event.transaction.transactionHash}:${event.eventName}`, event)));
        });
        setIsEventsLoading(false);
      });
    }

    contract.events.listenToAllEvents((event) => {
      console.log("new event", event);
      setEvents((prev) => new Map(prev.set(`${event.transaction.transactionHash}:${event.eventName}`, event)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  return (
    <Box>
      {isEventsLoading && <Spinner />}
      <TableContainer>
        <Table variant="simple">
          <Tbody>
            {Array.from(events).map(([, event], index) => (
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
    </Box>
  );
}
