const _ = require('lodash');
const Logger = require('../utils/logger');
const {
  ElasticsearchAdapter,
  createFieldSearchQuery,
  createReposSearchQuery,
  omitPrivateKeys,
  parseResponse,
  searchTermsQuery,
  getQueryByTerm
} = require('@code.gov/code-gov-adapter').elasticsearch;
const {
  getInvalidRepoQueryParams,
  getAgencies,
  getAgencyTerms,
  getAgency,
  getLanguages,
  getRepoJson,
  getStatusData,
  getVersion,
  getAgencyIssues,
  getDiscoveredReposByAgency,
  getFetchedReposByAgency,
  getRootMessage,
  getAgencyMetaData,
  getAgencyData } = require('./utils');

const mappings = require('../indexes/repo/mapping.json');
const settings = require('../indexes/repo/settings.json');

function getApiRoutes(config, router) {

  const logger = new Logger({ name: 'routes.index', level: config.LOGGER_LEVEL });
  const adapter = new ElasticsearchAdapter({ hosts: config.ES_HOST, logger: null, mappings, settings });

  router.get('/repos/:id', async (request, response, next) => {
    try {
      const searchQuery = createFieldSearchQuery({
        queryType: 'match',
        field: 'repoID',
        value: request.params.id
      });
      const results = await adapter.search({ index: 'repos', type: 'repo', body: searchQuery });

      if(results.hasOwnProperty('data') === false || results.data.length === 0) {
        const error = new Error('Not Found');
        error.status = 404;
        next(error);
      }

      response.json(results.data);

    } catch(error) {
      next(error);
    }
  });
  router.get('/repos', async (request, response, next) => {
    const queryParamKeys = request.query;

    if(queryParamKeys.length) {
      let invalidParams = getInvalidRepoQueryParams(queryParamKeys);
      if (invalidParams.length > 0) {
        logger.trace(error);
        const error = new Error(`Invalid query parameters: ${invalidParams}`);
        error.status = 400;
        next(error);
      }
    }
    try {
      const searchQuery = createReposSearchQuery({ queryParams: request.query, indexMappings: mappings });
      const results = await adapter.search({ index: 'repos', type: 'repo', body: searchQuery });

      if(results.hasOwnProperty('data') === false || results.data.length === 0) {
        const error = new Error('Not Found');
        error.status = 404;
        next(error);
      }

      response.json(results);

    } catch(error) {
      logger.trace(error);
      next(error);
    }
  });
  router.get('/terms', async (request, response, next) => {
    try {
      const searchQuery = searchTermsQuery({
        queryParams: request.query,
        termTypesToSearch: config.TERM_TYPES_TO_SEARCH
      });

      const results = await adapter.search({
        index: 'terms',
        type: 'term',
        body: searchQuery
      });

      if(results.hasOwnProperty('data') === false || results.data.length === 0) {
        const error = new Error('Not Found');
        error.status = 404;
        next(error);
      }

      response.json(results);

    } catch(error) {
      logger.trace(error);
      next(error);
    }
  });
  router.get(`/agencies`, async (request, response, next) => {
    try {
      const agenciesMetaData = await getAgencyMetaData(config);

      const queryParams = getAgencyTerms(request);
      const searchQuery = searchTermsQuery({ queryParams, termTypesToSearch: config.TERM_TYPES_TO_SEARCH });
      const results = await adapter.search({ index: 'terms', type: 'term', body: searchQuery });

      const agenciesData = {
        agencyTerms: {
          terms: results.data
        },
        agenciesDataHash: agenciesMetaData
      };

      const agencies = getAgencies(agenciesData, request.query, logger);

      if(agencies.total > 0) {
        response.json(agencies);
      } else {
        response.sendStatus(404);
      }
    } catch(error) {
      logger.trace(error);
      next(error);
    }
  });
  router.get(`/agencies/:agency_acronym`, async (request, response, next) => {
    try {
      const agenciesMetaData = await getAgencyMetaData(config);

      const queryParams = getAgencyTerms(request);
      const searchQuery = getQueryByTerm({ term: queryParams.term, termType: queryParams.term_type });
      const results = await adapter.search({ index: 'terms', type: 'term', body: searchQuery });

      const agenciesData = {
        agencyTerms: {
          terms: results.data
        },
        agenciesDataHash: agenciesMetaData
      };

      const data = getAgencies(agenciesData, request.query, logger);

      if(data.total > 0) {
        response.json(data.agencies[0]);
      } else {
        response.sendStatus(404);
      }
    } catch(error) {
      logger.trace(error);
      next(error);
    }
  });
  // router.get(`/languages`, (request, response, next) => {
  //   let options;
  //   getLanguages(request, searcher, logger, options)
  //     .then(results => {
  //       if (results) {
  //         response.json(results);
  //       } else {
  //         response.sendStatus(404);
  //       }
  //     })
  //     .catch(error => {
  //       logger.error(error);
  //       response.sendStatus(404);
  //     });
  // });
  router.get('/repo.json', (request, response, next) => {
    try{
      response.json(getRepoJson(response))
    } catch(error) {
      logger.trace(error);
      next(error);
    }
  });
  router.get('/status.json', async (request, response, next) => {
    try {
      const results = await adapter.search({ index: 'status', type: 'status' });

      if(results.total > 0){
        const data = _.omit( results.data[0], config.AGENCIES_TO_OMIT_FROM_STATUS );
        response.json(data);
      } else {
        response.sendStatus(404);
      }
    } catch(error) {
      logger.trace(error);
      next(error);
    };
  });
  router.get(`/status`, async (request, response, next) => {
    try {
      const results = await adapter.search({ index: 'status', type: 'status' });

      if(results.total > 0){
        const data = _.omit( results.data[0], config.AGENCIES_TO_OMIT_FROM_STATUS );
        response.render('status', { title: "Code.gov API Status", statusData: data });
      } else {
        response.render('status', { title: "Code.gov API Status", statusData: {} });
      }
    } catch(error) {
      logger.trace(error);
      next(error);
    };
  });

  router.get(`/status/:agency/issues`, async (request, response, next) => {
    try {
      let agency = request.params.agency.toUpperCase();
      const results = await adapter.search({ index: 'status', type: 'status' });

      if(results.total > 0){
        const data = _.omit( results.data[0], config.AGENCIES_TO_OMIT_FROM_STATUS );
        const agencyIssues = data.statuses[agency].issues;
        response.render('status/agency/issues', { title: `Code.gov API Status for ${agency}`, statusData: agencyIssues });
      } else {
        response.render('status/agency/issues', { title: `Code.gov API Status for ${agency}`, statusData: {} });
      }
    } catch(error) {
      logger.trace(error);
      next(error);
    };
  });
  // router.get(`/status/:agency/fetched`, async (request, response, next) => {
  //   const agency = request.params.agency.toUpperCase();

  //   try {
  //     const results = await getFetchedReposByAgency(agency, config);
  //     response.json(results);
  //   } catch(error) {
  //     logger.trace(error);
  //     next(error);
  //   }
  // });
  // router.get(`/status/:agency/discovered`, (request, response, next) => {
  //   const agency = request.params.agency.toUpperCase();

  //   if(agency) {
  //     getDiscoveredReposByAgency(agency, config)
  //       .then(results => {
  //         if(results) {
  //           response.json(results);
  //         } else {
  //           response.sendStatus(404);
  //         }
  //       })
  //       .catch(error => {
  //         logger.error(error);
  //         response.sendStatus(404);
  //       });
  //   } else {
  //     response.sendStatus(400);
  //   }
  // });
  router.get('/version', (request, response, next) => {
    getVersion(response)
      .then(versionInfo => response.json(versionInfo))
      .catch(error => {
        logger.error(error);
        response.sendStatus(404);
      });
  });

  router.get('/', (request, response, next) =>
    getRootMessage()
      .then(rootMessage => response.json(rootMessage))
  );
  return router;

  // router.get(`/status/:agency/diff`, (req, res, next) => {
  //   let agency = req.params.agency.toUpperCase();
  //   Jsonfile.readFile(path.join(
  //     __dirname,
  //     config.DIFFED_DIR,
  //     `${agency}.json`
  //   ), (err, diffChunks) => {
  //     if (err) {
  //       logger.error(err);
  //       return res.sendStatus(500);
  //     }
  //     let title = "Code.gov API Diff for " + agency;
  //     return res.render('status/agency/diff', { title, diffChunks });
  //   });
  // });
}

module.exports = {
  getApiRoutes
};
