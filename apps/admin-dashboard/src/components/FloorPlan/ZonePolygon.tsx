import React from 'react';
import { Group, Line, Text, Rect } from 'react-konva';
import { FloorZoneDTO } from '@mesaya/shared';

interface ZonePolygonProps {
  zone: FloorZoneDTO;
}

export const ZonePolygon: React.FC<ZonePolygonProps> = ({ zone }) => {
  const { name, color = '#3b82f6', polygonPoints = [] } = zone;

  if (!polygonPoints || polygonPoints.length < 3) {
    return null;
  }

  // Flatten [{x, y}, ...] to [x1, y1, x2, y2, ...]
  const flatPoints = polygonPoints.reduce<number[]>((acc, pt) => {
    acc.push(pt.x, pt.y);
    return acc;
  }, []);

  const firstPt = polygonPoints[0] || { x: 0, y: 0 };

  return (
    <Group>
      {/* Zone boundary polygon */}
      <Line
        points={flatPoints}
        closed={true}
        fill={`${color}15`} // 10% opacity fill
        stroke={`${color}60`} // 40% opacity border
        strokeWidth={1.5}
        dash={[8, 4]}
      />

      {/* Zone label tag in corner */}
      <Group x={firstPt.x + 10} y={firstPt.y + 10}>
        <Rect
          x={0}
          y={0}
          width={name.length * 8 + 20}
          height={24}
          cornerRadius={6}
          fill="rgba(15, 23, 42, 0.75)"
          stroke={`${color}80`}
          strokeWidth={1}
        />
        <Text
          x={10}
          y={6}
          text={name}
          fontSize={11}
          fontFamily="sans-serif"
          fontStyle="bold"
          fill={color}
        />
      </Group>
    </Group>
  );
};
