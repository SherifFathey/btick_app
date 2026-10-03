import { BehaviorTreeDocument } from './types';

export const DEFAULT_BT_XML_TEMPLATE = `<root BTCPP_format="4" main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence>
      <AlwaysSuccess name="init_step"/>
    </Sequence>
  </BehaviorTree>
</root>
`;

export const createDefaultDocument = (treeId: string = 'MainTree'): BehaviorTreeDocument => {
  const rootNodeId = 'root_sequence';
  const childNodeId = 'init_step';

  return {
    formatVersion: '4',
    mainTreeId: treeId,
    treeOrder: [treeId],
    trees: {
      [treeId]: {
        id: treeId,
        rootNodeId,
        customAttributes: {},
        nodes: {
          [rootNodeId]: {
            id: rootNodeId,
            type: 'Sequence',
            name: '',
            category: 'Control',
            attributes: {},
            inputPorts: {},
            outputPorts: {},
            children: [childNodeId],
            parentId: null,
            position: { x: 250, y: 50 },
          },
          [childNodeId]: {
            id: childNodeId,
            type: 'AlwaysSuccess',
            name: 'init_step',
            category: 'Action',
            attributes: {},
            inputPorts: {},
            outputPorts: {},
            children: [],
            parentId: rootNodeId,
            position: { x: 250, y: 180 },
          },
        },
      },
    },
    customRootAttributes: {},
    nodeModels: {},
    fileName: 'behavior_tree.xml',
  };
};
