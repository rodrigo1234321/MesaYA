import React from 'react';
import { Group, Rect, Circle, Text, Line } from 'react-konva';
import { FloorTableDTO, TableFSMState, STATE_COLORS, STATE_EMOJIS } from '@mesaya/shared';

interface TableNodeProps {
  table: FloorTableDTO;
  isSelected: boolean;
  isEditorMode: boolean;
  gridSize?: number;
  onSelect: (tableId: string) => void;
  onDragEnd?: (tableId: string, posX: number, posY: number) => void;
}

export const TableNode: React.FC<TableNodeProps> = ({
  table,
  isSelected,
  isEditorMode,
  gridSize = 20,
  onSelect,
  onDragEnd
}) => {
  const {
    id,
    label,
    posX,
    posY,
    width = 80,
    height = 80,
    shape = 'RECT',
    currentState = TableFSMState.AVAILABLE,
    activeCall,
    occupancyMinutes
  } = table;

  const fsmState = currentState as TableFSMState;
  const visual = STATE_COLORS[fsmState] || STATE_COLORS[TableFSMState.AVAILABLE];
  const emoji = STATE_EMOJIS[fsmState] || '🟢';

  // Handle snap-to-grid on drag
  const handleDragEnd = (e: any) => {
    if (!onDragEnd) return;
    const rawX = e.target.x();
    const rawY = e.target.y();
    const snappedX = Math.round(rawX / gridSize) * gridSize;
    const snappedY = Math.round(rawY / gridSize) * gridSize;
    e.target.position({ x: snappedX, y: snappedY });
    onDragEnd(id, snappedX, snappedY);
  };

  const isBillCall = activeCall?.type === 'BILL';
  const hasCall = !!activeCall;

  // Format occupancy time
  let timerText = '';
  if (occupancyMinutes !== null && occupancyMinutes > 0) {
    if (occupancyMinutes < 60) {
      timerText = `${occupancyMinutes}m`;
    } else {
      const h = Math.floor(occupancyMinutes / 60);
      const m = occupancyMinutes % 60;
      timerText = `${h}h${m > 0 ? ` ${m}m` : ''}`;
    }
  }

  return (
    <Group
      x={posX}
      y={posY}
      draggable={isEditorMode}
      onDragEnd={handleDragEnd}
      onClick={() => onSelect(id)}
      onTap={() => onSelect(id)}
    >
      {/* Active Call Alert Ring (pulsing / highlighted) */}
      {hasCall && (
        <Rect
          x={-6}
          y={-6}
          width={width + 12}
          height={height + 12}
          cornerRadius={shape === 'ROUND' ? width / 2 + 6 : 14}
          stroke={isBillCall ? '#c084fc' : '#fbbf24'}
          strokeWidth={3}
          dash={[6, 4]}
          opacity={0.8}
        />
      )}

      {/* Selected Halo in Editor Mode */}
      {isSelected && (
        <Rect
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
          cornerRadius={shape === 'ROUND' ? width / 2 + 4 : 12}
          stroke="#38bdf8"
          strokeWidth={2}
        />
      )}

      {/* Table Body Geometry */}
      {shape === 'ROUND' ? (
        <Circle
          x={width / 2}
          y={height / 2}
          radius={width / 2}
          fill={visual.hex}
          stroke={isSelected ? '#38bdf8' : 'rgba(0,0,0,0.2)'}
          strokeWidth={isSelected ? 2 : 1}
          shadowColor="black"
          shadowBlur={8}
          shadowOpacity={0.3}
          shadowOffsetY={3}
        />
      ) : shape === 'BOOTH' ? (
        <Group>
          {/* Main booth body */}
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            cornerRadius={10}
            fill={visual.hex}
            stroke={isSelected ? '#38bdf8' : 'rgba(0,0,0,0.2)'}
            strokeWidth={isSelected ? 2 : 1}
            shadowColor="black"
            shadowBlur={8}
            shadowOpacity={0.3}
            shadowOffsetY={3}
          />
          {/* Booth backrest indicator */}
          <Rect
            x={2}
            y={2}
            width={width - 4}
            height={10}
            cornerRadius={[8, 8, 0, 0]}
            fill="rgba(255,255,255,0.25)"
          />
        </Group>
      ) : (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={shape === 'SQUARE' ? 8 : 10}
          fill={visual.hex}
          stroke={isSelected ? '#38bdf8' : 'rgba(0,0,0,0.2)'}
          strokeWidth={isSelected ? 2 : 1}
          shadowColor="black"
          shadowBlur={8}
          shadowOpacity={0.3}
          shadowOffsetY={3}
        />
      )}

      {/* Top Bar: Emoji & Capacity */}
      <Text
        x={6}
        y={6}
        text={emoji}
        fontSize={14}
      />

      {/* Merged Table Badge */}
      {table.mergedWithTableId && (
        <Group x={width - 22} y={5}>
          <Rect
            x={0}
            y={0}
            width={18}
            height={16}
            cornerRadius={4}
            fill="#d97706"
          />
          <Text
            x={2}
            y={2}
            text="🔗"
            fontSize={10}
          />
        </Group>
      )}

      {/* Table Label (Center) */}
      <Text
        x={0}
        y={height / 2 - 10}
        width={width}
        text={label}
        fontSize={13}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        shadowColor="rgba(0,0,0,0.6)"
        shadowBlur={2}
      />

      {/* Timer Badge (Bottom) */}
      {timerText && (
        <Group x={width / 2 - 20} y={height - 20}>
          <Rect
            x={0}
            y={0}
            width={40}
            height={15}
            cornerRadius={7}
            fill="rgba(0,0,0,0.55)"
          />
          <Text
            x={0}
            y={2}
            width={40}
            text={timerText}
            fontSize={10}
            fontFamily="sans-serif"
            fontStyle="bold"
            fill="#f8fafc"
            align="center"
          />
        </Group>
      )}

      {/* Active Call Alert Badge (Floating Icon) */}
      {hasCall && (
        <Group x={width - 18} y={-6}>
          <Circle
            x={9}
            y={9}
            radius={10}
            fill={isBillCall ? '#9333ea' : '#d97706'}
            stroke="#ffffff"
            strokeWidth={1.5}
            shadowColor="black"
            shadowBlur={4}
          />
          <Text
            x={2}
            y={2}
            text={isBillCall ? '💳' : '🔔'}
            fontSize={11}
          />
        </Group>
      )}
    </Group>
  );
};
