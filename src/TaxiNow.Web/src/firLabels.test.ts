import { describe, expect, it } from 'vitest';
import { parseFirLabels } from './firLabels';

describe('parseFirLabels', () => {
  it('creates label points with a separate FIR code and readable name', () => {
    expect(parseFirLabels({ type: 'FeatureCollection', features: [{
      type: 'Feature',
      properties: { id: 'CZYZ', name: 'CZYZ · Toronto', label_lon: '-79.63', label_lat: '43.68' },
      geometry: { type: 'Polygon', coordinates: [] }
    }] })).toEqual([{ id: 'CZYZ', name: 'Toronto', longitude: -79.63, latitude: 43.68 }]);
  });

  it('drops entries without valid label coordinates', () => {
    expect(parseFirLabels({ type: 'FeatureCollection', features: [
      { properties: { id: 'BAD', name: 'Bad', label_lon: 'none', label_lat: '20' } },
      { properties: { id: '', name: 'Missing', label_lon: '10', label_lat: '20' } }
    ] })).toEqual([]);
  });
});
