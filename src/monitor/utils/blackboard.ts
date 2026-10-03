export type BlackboardValueType = 'bool' | 'int' | 'double' | 'string';

export const inferBlackboardValueType = (
  value: unknown,
): BlackboardValueType => {
  if (typeof value === 'boolean' || value === 'true' || value === 'false') {
    return 'bool';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double';
  }

  const stringValue = String(value ?? '');
  if (stringValue !== '' && !Number.isNaN(Number(stringValue))) {
    return stringValue.includes('.') ? 'double' : 'int';
  }
  return 'string';
};

export const formatBlackboardValue = (value: unknown): string => {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
};
