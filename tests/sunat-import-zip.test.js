'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deflateRawSync } = require('node:zlib');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'sunat-file-import.js'), 'utf8');
const sandbox = {
  window: {},
  TextDecoder,
  Uint8Array,
  DataView,
  Blob,
  Response,
  DecompressionStream,
};
vm.runInNewContext(source, sandbox);
const importer = sandbox.window.DeclarafySunatImport;

function makeZip(filename, contents, method = 8) {
  const name = Buffer.from(filename, 'utf8');
  const raw = Buffer.from(contents, 'utf8');
  const compressed = method === 8 ? deflateRawSync(raw) : raw;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localEntry = Buffer.concat([local, name, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralEntry = Buffer.concat([central, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralEntry.length, 12);
  end.writeUInt32LE(localEntry.length, 16);
  return Buffer.concat([localEntry, centralEntry, end]);
}

test('SIRE ZIP parser extracts a deflated CSV from the central directory', async () => {
  const csv = 'fecEmision;codTipoCDP;numSerieCDP;numCDP;numDocIdentidad;nomRazonSocial;codMoneda;mtoBaseImponible;mtoIGV;mtoTotal\n01/10/2026;01;F001;123;20123456789;Proveedor S.A.C.;PEN;100;18;118';
  const zip = makeZip('SIRE/rvie-202610.csv', csv, 8);
  const files = await importer.parseZip(new Blob([zip]));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'SIRE/rvie-202610.csv');
  assert.equal(files[0].text, csv);
});

test('SIRE ZIP parser supports stored files and rejects path traversal', async () => {
  const stored = makeZip('rvie.txt', 'contenido', 0);
  const files = await importer.parseZip(new Blob([stored]));
  assert.equal(files[0].text, 'contenido');

  const unsafe = makeZip('../escape.csv', 'x', 0);
  await assert.rejects(() => importer.parseZip(new Blob([unsafe])), /ruta de archivo no permitida/);
});

test('SIRE CSV field names map to Declarafy import fields', () => {
  const csv = 'fecEmision;codTipoCDP;numSerieCDP;numCDP;numDocIdentidad;nomRazonSocial;codMoneda;mtoBaseImponible;mtoIGV;mtoTotal\n01/10/2026;01;F001;123;20123456789;Proveedor S.A.C.;PEN;100;18;118';
  const rows = importer.parseDelimited(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fecha, '01/10/2026');
  assert.equal(rows[0].tipo, '01');
  assert.equal(rows[0].serie, 'F001');
  assert.equal(rows[0].numero, '123');
  assert.equal(rows[0].ruc, '20123456789');
  assert.equal(rows[0].razon_social, 'Proveedor S.A.C.');
  assert.equal(rows[0].moneda, 'PEN');
  assert.equal(rows[0].base_imponible, 100);
  assert.equal(rows[0].igv, 18);
  assert.equal(rows[0].total, 118);
});
