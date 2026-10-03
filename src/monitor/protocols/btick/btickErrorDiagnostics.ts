export interface BTickErrorDiagnostics {
  treeName?: string;
  sessionId?: string;
  ros2NodeName?: string;
  category?: string;
  message?: string;
  isNodeNameConflict: boolean;
}

export function getBTickErrorDiagnostics(data: any): BTickErrorDiagnostics {
  if (!data) {
    return { isNodeNameConflict: false };
  }

  const isConflict = data.error_category === 'ros2_node_name_conflict';
  return {
    treeName: data.tree_name,
    sessionId: data.session_id,
    ros2NodeName: data.ros2_node_name,
    category: isConflict ? 'ROS2 node name already in use' : (data.error_category || data.category || 'General error'),
    message: data.error || data.message || '',
    isNodeNameConflict: isConflict,
  };
}

export function logBTickError(data: any): void {
  if (!data || (data.type !== 'initialization_error' && data.type !== 'connection_error' && data.type !== 'error')) {
    return;
  }
  const diag = getBTickErrorDiagnostics(data);
  console.error(`[BTick] Initialization failed: ${diag.treeName || 'Unknown Tree'}`);
  console.error(`[BTick] Error Category: ${diag.category}`);
  if (diag.ros2NodeName) {
    console.error(`[BTick] Conflicted ROS 2 Node Name: ${diag.ros2NodeName}`);
  }
  if (diag.message) {
    console.error(`[BTick] Details: ${diag.message}`);
  }
}
