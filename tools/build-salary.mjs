import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCalculator, calculatorAssets} from './build-holding-tax.mjs';

export const salaryAssets = Object.freeze([
  'calc/salary.html', 'js/salary.js', 'js/salary-app.js', 'js/salary-tax-table.js',
  ...calculatorAssets.filter(path => path.startsWith('css/') || ['js/site-theme.js', 'js/site-shell.js', 'js/apartment-links.js', 'js/member-library.js', 'js/auth-client.js', 'js/page-analytics.js'].includes(path)),
]);
export const buildSalary = root => buildCalculator(root, {scope: 'salary-local', assets: salaryAssets});
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildSalary(resolve(import.meta.dirname, '..'))));
