import { Code } from "@chakra-ui/react";

type CodeDisplayProps = {
  type: string;
  name?: string;
  inputs?: { name?: string; type: string }[];
  outputs?: { name?: string; type: string }[];
};

export function CodeDisplay({ type, name, inputs, outputs }: CodeDisplayProps) {
  const inputsString =
    inputs && inputs.length > 0
      ? inputs.map((input: { name?: string; type: string }, inputIndex) => `${input.name || `arg${inputIndex}`}: ${input.type}`).join(", ")
      : "";
  const outputsString = outputs && outputs.length > 0 ? outputs.map((output: { name?: string; type: string }) => output.type).join(", ") : "";

  return (
    <Code backgroundColor="transparent">
      <span style={{ color: "#a00" }}>{type}</span> {name || ""}({inputsString}) <span style={{ color: "#04c" }}>{outputsString}</span>
    </Code>
  );
}
