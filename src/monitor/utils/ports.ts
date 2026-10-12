import { BTNodeModel, BTPortDetail } from "../types/bt";

export const resolveNodePorts = (node: BTNodeModel): BTPortDetail[] => {
  const list: BTPortDetail[] = [];
  const seen = new Set<string>();

  node.port_details?.forEach((port) => {
    if (seen.has(port.name)) return;
    seen.add(port.name);
    list.push({
      ...port,
      runtime_value:
        port.runtime_value ?? node.output_ports_values?.[port.name],
    });
  });

  const addFallbackPort = (name: string, value: string) => {
    if (
      seen.has(name) ||
      name === "name" ||
      name === "ID" ||
      name.startsWith("_")
    ) {
      return;
    }

    seen.add(name);
    const isBlackboard = value.startsWith("{") && value.endsWith("}");
    list.push({
      name,
      direction: "Unknown",
      type: isBlackboard
        ? "string"
        : !Number.isNaN(Number(value)) && value !== ""
          ? value.includes(".")
            ? "double"
            : "int"
          : value === "true" || value === "false"
            ? "bool"
            : "string",
      mode: isBlackboard ? "Blackboard" : "Literal",
      value,
      runtime_value: node.output_ports_values?.[name],
    });
  };

  Object.entries(node.ports || {}).forEach(([name, value]) =>
    addFallbackPort(name, String(value ?? "")),
  );
  Object.entries(node.attributes || {}).forEach(([name, value]) =>
    addFallbackPort(name, String(value ?? "")),
  );

  return list;
};
