# Browser tests

`npm run e2e --workspace=@waybook/app` runs the Waybook booking, calendar and tenant-access tests on desktop and mobile. It requires a production build and three **disposable local** PostgreSQL databases. Set `WAYBOOK_CONTROL_DATABASE_URL`, `WAYBOOK_NORDIC_STUDIO_DATABASE_URL` and `WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL` to those databases, with names beginning `waybook_e2e_`; run `npm run waybook:db:migrate`, `npm run waybook:db:seed` and `node --import tsx scripts/seed-waybook-e2e.mts` first. The CI workflow shows the complete setup. Never point the seed commands at production data.

The upstream demo-gallery tests are retained as `npm run e2e:legacy --workspace=@waybook/app`. They target a former homepage and are not Waybook release checks.
