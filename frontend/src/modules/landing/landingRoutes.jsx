import { Navigate, Route } from 'react-router-dom';
import LandingShell from './LandingShell';
import { LANDING_REDIRECTS, LANDING_TABS } from './landingTabs';
import Home from './pages/Home';
import Services from './pages/Services';
import Franchise from './pages/Franchise';
import Drive from './pages/Drive';
import AboutUs from './pages/AboutUs';
import ContactUs from './pages/ContactUs';

const PAGES = {
  home: Home,
  services: Services,
  franchise: Franchise,
  driver: Drive,
  about: AboutUs,
  contact: ContactUs,
};

const landingRoutes = (
  <Route element={<LandingShell />}>
    {LANDING_TABS.map(({ id, path }) => {
      const Page = PAGES[id];
      return <Route key={id} path={path} element={<Page />} />;
    })}
    {LANDING_REDIRECTS.map(({ from, to }) => (
      <Route key={from} path={from} element={<Navigate to={to} replace />} />
    ))}
  </Route>
);

export default landingRoutes;
