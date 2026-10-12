import { BTEditorNodeCategory, BTNodeModelDefinition } from "./types";

export const BUILTIN_NODE_DEFINITIONS: Record<string, BTNodeModelDefinition> = {
  // --- CONTROL NODES ---
  Sequence: {
    type: "Sequence",
    category: "Control",
    description:
      "Ticks children sequentially. Fails if any child fails. Returns RUNNING if a child is RUNNING.",
  },
  Fallback: {
    type: "Fallback",
    category: "Control",
    description:
      "Ticks children sequentially. Succeeds if any child succeeds. Fails only if all children fail.",
  },
  ReactiveSequence: {
    type: "ReactiveSequence",
    category: "Control",
    description:
      "Sequence that restarts and re-evaluates all previous children when running.",
  },
  ReactiveFallback: {
    type: "ReactiveFallback",
    category: "Control",
    description:
      "Fallback that re-evaluates previous conditions even while a subsequent child is running.",
  },
  Parallel: {
    type: "Parallel",
    category: "Control",
    description: "Ticks all children concurrently.",
    inputPorts: [
      {
        name: "success_count",
        type: "int",
        defaultValue: "-1",
        description: "Threshold for success",
      },
      {
        name: "failure_count",
        type: "int",
        defaultValue: "1",
        description: "Threshold for failure",
      },
    ],
  },
  SequenceWithMemory: {
    type: "SequenceWithMemory",
    category: "Control",
    description:
      "Sequence that remembers the last RUNNING child and resumes from it.",
  },
  IfThenElse: {
    type: "IfThenElse",
    category: "Control",
    description:
      "Takes 2 or 3 children: 1st is Condition, 2nd is Then, optional 3rd is Else.",
  },
  WhileDoElse: {
    type: "WhileDoElse",
    category: "Control",
    description: "Looping construct: Condition, WhileBody, optional Else.",
  },
  RecoveryNode: {
    type: "RecoveryNode",
    category: "Control",
    description: "Takes 2 children: Primary and Recovery.",
    inputPorts: [
      {
        name: "number_of_retries",
        type: "int",
        defaultValue: "1",
        description: "Number of recovery retries",
      },
    ],
  },
  RoundRobin: {
    type: "RoundRobin",
    category: "Control",
    description:
      "Cycles through children in a round-robin manner on successive ticks.",
  },
  Switch2: {
    type: "Switch2",
    category: "Control",
    description: "Branches execution based on variable matching case values.",
    inputPorts: [
      {
        name: "variable",
        type: "std::string",
        description: "Blackboard variable to switch on",
      },
      { name: "case_1", type: "std::string" },
      { name: "case_2", type: "std::string" },
    ],
  },
  Switch3: {
    type: "Switch3",
    category: "Control",
    description: "Branches execution based on variable matching case values.",
    inputPorts: [
      { name: "variable", type: "std::string" },
      { name: "case_1", type: "std::string" },
      { name: "case_2", type: "std::string" },
      { name: "case_3", type: "std::string" },
    ],
  },

  // --- DECORATOR NODES ---
  Inverter: {
    type: "Inverter",
    category: "Decorator",
    description: "Inverts SUCCESS into FAILURE, and FAILURE into SUCCESS.",
  },
  RetryUntilSuccessful: {
    type: "RetryUntilSuccessful",
    category: "Decorator",
    description: "Retries child execution on FAILURE up to num_attempts.",
    inputPorts: [
      {
        name: "num_attempts",
        type: "int",
        defaultValue: "3",
        description: "Maximum retry attempts (-1 for infinite)",
      },
    ],
  },
  Repeat: {
    type: "Repeat",
    category: "Decorator",
    description: "Repeats child execution on SUCCESS up to num_cycles.",
    inputPorts: [
      {
        name: "num_cycles",
        type: "int",
        defaultValue: "1",
        description: "Number of repetition cycles (-1 for infinite)",
      },
    ],
  },
  Timeout: {
    type: "Timeout",
    category: "Decorator",
    description: "Fails if the child does not finish within msec milliseconds.",
    inputPorts: [
      {
        name: "msec",
        type: "int",
        defaultValue: "1000",
        description: "Timeout duration in milliseconds",
      },
    ],
  },
  RateController: {
    type: "RateController",
    category: "Decorator",
    description: "Limits ticking rate of the child to hz frequency.",
    inputPorts: [
      {
        name: "hz",
        type: "double",
        defaultValue: "10.0",
        description: "Ticking rate in Hertz",
      },
    ],
  },
  KeepRunningUntilFailure: {
    type: "KeepRunningUntilFailure",
    category: "Decorator",
    description: "Returns RUNNING until the child returns FAILURE.",
  },
  ForceSuccess: {
    type: "ForceSuccess",
    category: "Decorator",
    description:
      "Always returns SUCCESS upon child completion regardless of child outcome.",
  },
  ForceFailure: {
    type: "ForceFailure",
    category: "Decorator",
    description:
      "Always returns FAILURE upon child completion regardless of child outcome.",
  },
  Delay: {
    type: "Delay",
    category: "Decorator",
    description: "Delays child execution by delay_msec.",
    inputPorts: [
      {
        name: "delay_msec",
        type: "int",
        defaultValue: "1000",
        description: "Delay in milliseconds",
      },
    ],
  },
  Precondition: {
    type: "Precondition",
    category: "Decorator",
    description: "Checks script or condition before executing child.",
    inputPorts: [
      {
        name: "if",
        type: "std::string",
        description: "Script condition expression",
      },
      {
        name: "else",
        type: "std::string",
        defaultValue: "FAILURE",
        description: "Return if condition is false",
      },
    ],
  },

  // --- ACTION NODES ---
  AlwaysSuccess: {
    type: "AlwaysSuccess",
    category: "Action",
    description: "Immediate action that always returns SUCCESS.",
  },
  AlwaysFailure: {
    type: "AlwaysFailure",
    category: "Action",
    description: "Immediate action that always returns FAILURE.",
  },
  Script: {
    type: "Script",
    category: "Action",
    description: "Executes a scripting expression on the Blackboard.",
    inputPorts: [
      {
        name: "code",
        type: "std::string",
        description: "Expression e.g. goal_x:=10",
      },
    ],
  },
  Sleep: {
    type: "Sleep",
    category: "Action",
    description: "Asynchronous sleep action.",
    inputPorts: [
      {
        name: "msec",
        type: "int",
        defaultValue: "1000",
        description: "Sleep duration in milliseconds",
      },
    ],
  },

  // --- CONDITION NODES ---
  ScriptCondition: {
    type: "ScriptCondition",
    category: "Condition",
    description: "Evaluates a boolean script expression on the Blackboard.",
    inputPorts: [
      {
        name: "code",
        type: "std::string",
        description: "Condition expression e.g. battery > 20",
      },
    ],
  },

  // --- SUBTREE NODES ---
  SubTree: {
    type: "SubTree",
    category: "SubTree",
    description: "Invokes another BehaviorTree by ID.",
    inputPorts: [
      { name: "ID", type: "std::string", description: "Target SubTree ID" },
    ],
  },
  SubTreePlus: {
    type: "SubTreePlus",
    category: "SubTree",
    description:
      "SubTree invocation with explicit port remapping and isolated blackboard.",
    inputPorts: [
      { name: "ID", type: "std::string", description: "Target SubTree ID" },
    ],
  },
};

export const inferNodeCategory = (type: string): BTEditorNodeCategory => {
  if (BUILTIN_NODE_DEFINITIONS[type]) {
    return BUILTIN_NODE_DEFINITIONS[type].category;
  }

  const lower = type.toLowerCase();
  if (
    lower.includes("sequence") ||
    lower.includes("fallback") ||
    lower.includes("parallel") ||
    lower.includes("recovery") ||
    lower.includes("roundrobin") ||
    lower.includes("switch")
  ) {
    return "Control";
  }
  if (
    lower.includes("inverter") ||
    lower.includes("retry") ||
    lower.includes("timeout") ||
    lower.includes("repeat") ||
    lower.includes("rate") ||
    lower.includes("delay") ||
    lower.includes("force")
  ) {
    return "Decorator";
  }
  if (lower.startsWith("subtree") || lower.includes("subtree")) {
    return "SubTree";
  }
  if (
    lower.startsWith("is") ||
    lower.startsWith("check") ||
    lower.startsWith("has") ||
    lower.startsWith("are") ||
    lower.startsWith("would") ||
    lower.includes("condition")
  ) {
    return "Condition";
  }

  return "Action";
};
