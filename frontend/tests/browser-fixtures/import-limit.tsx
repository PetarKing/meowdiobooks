import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { wizardApi } from '../../src/api/client';
import '../../src/i18n';
import '../../src/styles/product.css';

// Synthetic browser check: no files or requests leave this fixture.
let submitted = 0;
const gateway = Object.create(wizardApi);
gateway.listBooks = async () => [];
gateway.listLibrary = async () => [];
gateway.importBook = async () => {
  submitted += 1;
  document.getElementById('submitted')!.textContent = `Submitted: ${submitted}`;
  throw new Error('Synthetic endpoint rejected the document');
};
createRoot(document.getElementById('root')!).render(<>
  <App maxImportBytes={1_000_000} gateway={gateway} />
  <output id="submitted">Submitted: 0</output>
</>);
