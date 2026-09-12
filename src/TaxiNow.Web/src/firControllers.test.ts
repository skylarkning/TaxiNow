import { expect, it } from 'vitest';
import { controllersForFir, onlineFirIds } from './firControllers';
it('matches alternate callsigns and keeps sub-sector frequencies in their mapped region', () => {
 const mapping = [{prefix:'TOR',id:'CZYZ'},{prefix:'TOR_N',id:'CZYZ-N'},{prefix:'NY',id:'KZNY'}];
 const controllers = [{callsign:'TOR_CTR',frequency:'128.300'},{callsign:'TOR_N_CTR',frequency:'125.000'},{callsign:'TORONTO_CTR',frequency:'120.000'},{callsign:'TOR_TWR',frequency:'119.000'}];
 expect(controllersForFir('CZYZ',controllers,mapping).map(c=>c.callsign)).toEqual(['TOR_CTR']);
 expect(controllersForFir('CZYZ-N',controllers,mapping).map(c=>c.callsign)).toEqual(['TOR_N_CTR']);
 expect(controllersForFir('KZNY',controllers,mapping)).toEqual([]);
});

it('returns the FIR regions that currently have mapped area controllers online', () => {
 const mapping = [{prefix:'TOR',id:'CZYZ'},{prefix:'TOR_N',id:'CZYZ-N'},{prefix:'NY',id:'KZNY'}];
 const controllers = [{callsign:'TOR_CTR',frequency:'128.300'},{callsign:'TOR_N_CTR',frequency:'125.000'},{callsign:'NY_CTR',frequency:'133.000'},{callsign:'TOR_TWR',frequency:'119.000'}];
 expect(onlineFirIds(controllers,mapping)).toEqual(['CZYZ','CZYZ-N','KZNY']);
});
