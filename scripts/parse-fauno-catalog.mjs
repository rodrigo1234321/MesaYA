#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSource = path.join(root, 'data', 'fauno', 'source.txt');
const defaultOutput = path.join(root, 'data', 'fauno', 'catalog.json');
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutput;

const categoryDefinitions = [
  ['Cervezas', '🍺'],
  ['Entradas', '🥟'],
  ['De Mar', '🌊'],
  ['Papas', '🍟'],
  ['Sin Tacc', '🌾'],
  ['Panchitos', '🌭'],
  ['Tacos', '🌮'],
  ['Hamburguesas', '🍔'],
  ['Milanesas XXL', '🍽️'],
  ['Pizzas', '🍕'],
  ['Pollito', '🍗'],
  ['Ensaladas', '🥗'],
  ['Sin alcohol', '🧃'],
  ['Lo de siempre', '🥃'],
  ['De autor', '✨'],
  ['Caipis y Mojitos', '🍹'],
  ['Spritz', '🍊'],
  ['Passions', '🥭'],
  ['Juleps', '🌿'],
  ['Negronis', '🍸'],
  ['Coctelería clasica', '🍸'],
  ['Frozzens', '❄️'],
  ["Premium Gin's", '🍸'],
  ['Medidas', '🥃'],
  ['Vinos y espumantes', '🍷'],
  ['Botellas', '🍾']
];

const categories = new Map(categoryDefinitions.map(([name, icon], orderIndex) => [name, { name, icon, orderIndex, items: [] }]));
const categoryNames = new Set(categories.keys());
const lines = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const priceLine = /^\$\s*([0-9][0-9.,]*)$/;
const categoryIndexes = new Map();
const priceIndexes = [];

for (let index = 0; index < lines.length; index += 1) {
  const value = lines[index].trim();
  if (categoryNames.has(value)) categoryIndexes.set(index, value);
  if (priceLine.test(value)) priceIndexes.push(index);
}

function lastIndexBefore(values, index) {
  let result = -1;
  for (const value of values) {
    if (value < index) result = value;
    else break;
  }
  return result;
}

function cleanText(value) {
  return value.replace(/\s+/g, ' ').replace(/[\s.]+$/, '').trim();
}

function parsePrice(value) {
  return Number(value.replace(/\./g, '').replace(',', '.'));
}

function tagsFor(category, name, description) {
  const normalized = `${category} ${name} ${description}`.toLowerCase();
  const tags = [];
  if (category === 'Sin Tacc' || normalized.includes('sin tacc')) tags.push('GLUTEN_FREE');
  if (/\bveggie\b|vegetarian/.test(normalized)) tags.push('VEGETARIAN');
  if (/fauno|jammin|super fauno|mar del tabla|toxica|milanesa fauno/.test(normalized)) tags.push('CHEF_PICK');
  if (/proximamente/.test(normalized)) tags.push('COMING_SOON');
  return [...new Set(tags)];
}

function blockForPrice(priceIndex) {
  const previousPrice = lastIndexBefore(priceIndexes, priceIndex);
  const previousCategory = lastIndexBefore([...categoryIndexes.keys()].sort((a, b) => a - b), priceIndex);
  const start = Math.max(previousPrice, previousCategory) + 1;
  return lines.slice(start, priceIndex).map((line) => line.trim()).filter(Boolean);
}

for (const priceIndex of priceIndexes) {
  const categoryIndex = lastIndexBefore([...categoryIndexes.keys()].sort((a, b) => a - b), priceIndex);
  if (categoryIndex < 0) continue;
  const categoryName = categoryIndexes.get(categoryIndex);
  if (!categories.has(categoryName) || categoryName === 'Promos y novedades') continue;

  const block = blockForPrice(priceIndex);
  const photoIndex = [...block.keys()].filter((index) => block[index].toLowerCase().startsWith('foto de ')).pop();
  let nameIndex = photoIndex === undefined ? 0 : photoIndex + 1;
  while (nameIndex < block.length && (!block[nameIndex] || block[nameIndex].toLowerCase().startsWith('foto de '))) nameIndex += 1;
  if (nameIndex >= block.length) continue;

  const name = cleanText(block[nameIndex]);
  if (!name || categoryNames.has(name) || name.toLowerCase() === 'pedido') continue;
  const description = cleanText(block.slice(nameIndex + 1).filter((line) => !/^desde$/i.test(line) && !/^foto de /i.test(line)).join(' '));
  const price = parsePrice(priceLine.exec(lines[priceIndex].trim())[1]);
  const tags = tagsFor(categoryName, name, description);
  const isAvailable = !tags.includes('COMING_SOON');
  categories.get(categoryName).items.push({
    name,
    description: description || null,
    price,
    priceMinor: Math.round(price * 100),
    tags,
    isFeatured: tags.includes('CHEF_PICK'),
    isAvailable,
    source: 'fauno-user-catalog-2026-09-20'
  });
}

const output = {
  schemaVersion: 1,
  restaurant: {
    name: 'Fauno Olavarría',
    slug: 'fauno-olavarria',
    address: 'Olavarría 3232, Mar del Plata, Buenos Aires',
    phone: '+542234242548',
    timezone: 'America/Argentina/Buenos_Aires',
    currency: 'ARS',
    templateId: 'FAUNO_NIGHT',
    themeColor: '#16c5df',
    logoUrl: '/assets/branding/fauno-olavarria-logo.png',
    coverImageUrl: '/assets/branding/fauno-olavarria-logo.png'
  },
  promotions: [
    { name: 'Noche de fútbol', description: 'Happy en Fernet Branca durante todo el partido. Confirmar equipos y vigencia antes de publicar.', source: 'fauno-user-catalog-2026-09-20' },
    { name: 'Estudiantes 15% OFF', description: 'Promoción para estudiantes, con condiciones de certificado, máximo de mesa y pago en efectivo por confirmar.', source: 'fauno-user-catalog-2026-09-20' },
    { name: 'Todos los días son de Fauno', description: 'Promociones por día de la semana. Informativas hasta que el local confirme vigencia y reglas.', source: 'fauno-user-catalog-2026-09-20' }
  ],
  categories: [...categories.values()].filter((category) => category.items.length > 0)
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
const itemCount = output.categories.reduce((total, category) => total + category.items.length, 0);
console.log(JSON.stringify({ outputPath, categories: output.categories.length, items: itemCount }, null, 2));
