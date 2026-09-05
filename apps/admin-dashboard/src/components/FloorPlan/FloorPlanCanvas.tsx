import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Line, Rect } from 'react-konva';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import { TableNode } from './TableNode';
import { ZonePolygon } from './ZonePolygon';
import { TableFSMState } from '@mesaya/shared';

export const FloorPlanCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
  const [isTransitioning, setIsTransitioning] = useState(false);

  const {
    layout,
    zones,
    tables,
    scale,
    offset,
    setScale,
    setOffset,
    selectedTableId,
    selectTableCell,
    isEditorMode,
    filterState,
    activeSector,
    updateTablePositionLocal
  } = useFloorPlanStore();

  // Cinematic 3D floor-switch animation trigger
  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 240);
    return () => clearTimeout(timer);
  }, [activeSector]);

  // Resize canvas according to container
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Wheel zoom handler
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stage.scaleX();
    const mousePointTo = {
      x: pointer.x / oldScale - stage.x() / oldScale,
      y: pointer.y / oldScale - stage.y() / oldScale
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.35, Math.min(2.5, newScale));

    setScale(clampedScale);
    setOffset({
      x: -(mousePointTo.x - pointer.x / clampedScale) * clampedScale,
      y: -(mousePointTo.y - pointer.y / clampedScale) * clampedScale
    });
  };

  // Drag stage to pan
  const handleStageDragEnd = (e: any) => {
    if (e.target === e.target.getStage()) {
      setOffset({
        x: e.target.x(),
        y: e.target.y()
      });
    }
  };

  // Filter tables by FSM state AND floor/sector
  const visibleTables = tables.filter((t) => {
    if (filterState !== 'ALL' && t.currentState !== filterState) return false;
    if (activeSector !== 'ALL' && t.sector !== activeSector) return false;
    return true;
  });

  // Grid lines generation for editor mode
  const renderGrid = () => {
    if (!isEditorMode) return null;
    const lines = [];
    const gridSize = layout.gridSize || 20;
    const w = layout.canvasWidth || 1600;
    const h = layout.canvasHeight || 1000;

    // Vertical lines
    for (let x = 0; x <= w; x += gridSize) {
      lines.push(
        <Line
          key={`v-${x}`}
          points={[x, 0, x, h]}
          stroke="rgba(255, 255, 255, 0.04)"
          strokeWidth={1}
        />
      );
    }

    // Horizontal lines
    for (let y = 0; y <= h; y += gridSize) {
      lines.push(
        <Line
          key={`h-${y}`}
          points={[0, y, w, y]}
          stroke="rgba(255, 255, 255, 0.04)"
          strokeWidth={1}
        />
      );
    }

    return lines;
  };

  return (
    <div
      ref={containerRef}
      style={{
        perspective: '1200px',
        transition: 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease',
        transform: isTransitioning
          ? 'scale(0.93) translateZ(-60px) translateX(-25px) rotateY(-3deg)'
          : 'scale(1) translateZ(0) translateX(0) rotateY(0)',
        opacity: isTransitioning ? 0.35 : 1
      }}
      className="w-full h-full bg-slate-950 overflow-hidden relative select-none cursor-grab active:cursor-grabbing"
    >
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        scaleX={scale}
        scaleY={scale}
        x={offset.x}
        y={offset.y}
        draggable={true}
        onWheel={handleWheel}
        onDragEnd={handleStageDragEnd}
        onClick={(e) => {
          // Deselect table if clicked on empty canvas space
          if (e.target === e.target.getStage()) {
            selectTableCell(null);
          }
        }}
      >
        {/* Layer 1: Background & Grid */}
        <Layer>
          {/* Canvas bounds boundary box */}
          <Rect
            x={0}
            y={0}
            width={layout.canvasWidth || 1200}
            height={layout.canvasHeight || 800}
            fill="#090d16"
            stroke="#1e293b"
            strokeWidth={2}
            cornerRadius={12}
            shadowColor="black"
            shadowBlur={20}
            shadowOpacity={0.6}
          />
          {renderGrid()}
        </Layer>

        {/* Layer 2: Zones */}
        <Layer>
          {zones.map((zone) => (
            <ZonePolygon key={zone.id} zone={zone} />
          ))}
        </Layer>

        {/* Layer 2.5: Merged Table Connectors */}
        <Layer>
          {visibleTables
            .filter((t) => t.mergedWithTableId && t.id < (t.mergedWithTableId || ''))
            .map((t) => {
              const partner = visibleTables.find((p) => p.id === t.mergedWithTableId);
              if (!partner) return null;
              const x1 = t.posX + (t.width || 80) / 2;
              const y1 = t.posY + (t.height || 80) / 2;
              const x2 = partner.posX + (partner.width || 80) / 2;
              const y2 = partner.posY + (partner.height || 80) / 2;

              return (
                <Line
                  key={`merged-conn-${t.id}-${partner.id}`}
                  points={[x1, y1, x2, y2]}
                  stroke="#fbbf24"
                  strokeWidth={3}
                  dash={[8, 5]}
                  opacity={0.85}
                />
              );
            })}
        </Layer>

        {/* Layer 3: Tables (Interactive Nodes) */}
        <Layer>
          {visibleTables.map((table) => (
            <TableNode
              key={table.id}
              table={table}
              isSelected={selectedTableId === table.id}
              isEditorMode={isEditorMode}
              gridSize={layout.gridSize || 20}
              onSelect={(id) => selectTableCell(id)}
              onDragEnd={(id, posX, posY) => updateTablePositionLocal(id, posX, posY)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};
