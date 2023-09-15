import VestingAbi from "./generated/contracts/vesting-v1/VestingV1.json";
import { VestingV1 } from "./generated/contracts/vesting-v1/VestingV1";
import { useState } from "react";
import { NonPayableTransactionObject } from "./generated/types";

type AbiItemProps = {
  contract: VestingV1;
  abi: (typeof VestingAbi.abi)[number];
};

function AbiItem({ contract, abi }: AbiItemProps) {
  const [result, setResult] = useState<string>("");

  const inputsString = abi.inputs
    .filter(Boolean)
    .map((input: { name?: string; type: string }, inputIndex) => `${input.name || `arg${inputIndex}`}: ${input.type}`)
    .join(", ");

  const outputsString =
    abi.outputs && abi.outputs.length > 0
      ? [
          ":",
          abi.outputs
            .filter(Boolean)
            .map((output: { name?: string; type: string }) => output.type)
            .join(", "),
        ].join(" ")
      : "";

  return (
    <div style={{ borderBottom: "2px solid #f00", marginBottom: "40px" }}>
      <h3>{[abi.type, abi.name, "(", inputsString, ")", outputsString].filter(Boolean).join(" ")}</h3>
      {abi.name && abi.type === "function" && abi.outputs && abi.outputs.length > 0 && (
        <>
          <div>{result}</div>
          <button
            onClick={() => {
              const methodName: keyof typeof contract.methods = abi.name as keyof typeof contract.methods;
              const args = abi.inputs.map((input) => input.name || "");
              console.log("args", args);

              // eslint-disable-next-line prefer-spread
              const functionToCall = (contract.methods[methodName] as (...args: unknown[]) => NonPayableTransactionObject<unknown>).apply(null, args);
              console.log(functionToCall);
              functionToCall.call().then((res: unknown) => {
                setResult(`Result: ${res}`);
              });
            }}
          >
            Run
          </button>
        </>
      )}
    </div>
  );
}

type VestingContractProps = {
  contract: VestingV1;
};

export function VestingContract({ contract }: VestingContractProps) {
  const Abi = VestingAbi.abi
    .sort((a, b) => {
      if (a.type === "function" && b.type !== "function") {
        return -1;
      }

      if (a.type !== "function" && b.type === "function") {
        return 1;
      }

      return 0;
    })
    .map((abi, index) => <AbiItem key={index} contract={contract} abi={abi} />);

  return <div>{Abi}</div>;
}
