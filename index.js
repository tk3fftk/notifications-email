'use strict';

const Joi = require('joi');
const emailer = require('./email');
const tinytim = require('tinytim');
const path = require('path');

const COLOR_MAP = {
    SUCCESS: '3D9970',
    FAILURE: 'FF4136',
    ABORTED: '767676',
    RUNNING: '7FDBFF',
    QUEUED: 'FFDC00'
};
const DEFAULT_STATUSES = ['FAILURE'];
// Joi Schema Validation
const SCHEMA_ADDRESS = Joi.string().email();
const SCHEMA_ADDRESSES = Joi.array()
    .items(SCHEMA_ADDRESS)
    .min(0);
const SCHEMA_STATUS = Joi.string().valid(Object.keys(COLOR_MAP));
const SCHEMA_STATUSES = Joi.array()
    .items(SCHEMA_STATUS)
    .min(0);
const SCHEMA_EMAIL = Joi.alternatives().try(
    Joi.object().keys({ addresses: SCHEMA_ADDRESSES, statuses: SCHEMA_STATUSES }),
    SCHEMA_ADDRESS, SCHEMA_ADDRESSES
    );
const SCHEMA_BUILD_SETTINGS = Joi.object()
    .keys({
        email: SCHEMA_EMAIL
    }).unknown(true);
const SCHEMA_BUILD_DATA = Joi.object()
    .keys({
        settings: SCHEMA_BUILD_SETTINGS.required(),
        status: SCHEMA_STATUS.required(),
        pipelineName: Joi.string(),
        jobName: Joi.string(),
        buildId: Joi.number().integer(),
        buildLink: Joi.string()
    });
const SCHEMA_SMTP_CONFIG = Joi.object()
    .keys({
        host: Joi.string().required(),
        port: Joi.number().integer().required(),
        from: SCHEMA_ADDRESS.required()
    });

class EmailNotifier {
    /**
    * Constructs an EmailNotifier
    * @constructor
    * @param {object} config - Screwdriver config object initialized in API
    * @param {Hapi.server} server - server initialized in API
    * @param {string} eventName - name of notification event to listen on
    */
    constructor(config, server, eventName) {
        this.config = Joi.attempt(config, SCHEMA_SMTP_CONFIG,
            'Invalid config for email notifications');
        this.server = server;
        this.eventName = eventName; // The event that notify() will trigger a listener on
    }

    /**
    * Sets listener on server event of name 'eventName'
    * Currently, event is triggered with a build status is updated
    * @method notify
    * @return {Promise} resolves to false if status is not in notification statuses
    *                   resolves to emailer if status is in notification statuses
    */
    notify() {
        return new Promise((resolve, reject) => {
            this.server.on(this.eventName, (buildData) => {
                // Check buildData format against SCHEMA_BUILD_DATA
                try {
                    Joi.attempt(buildData, SCHEMA_BUILD_DATA, 'Invalid build data format');
                } catch (e) {
                    return reject(e);
                }

                if (typeof buildData.settings.email === 'string' ||
                    Array.isArray(buildData.settings.email)) {
                    buildData.settings.email = {
                        addresses: buildData.settings.email,
                        statuses: DEFAULT_STATUSES
                    };
                }

                if (!buildData.settings.email.statuses.includes(buildData.status)) {
                    return resolve(null);
                }

                const subject = `${buildData.status} - Screwdriver ${buildData.pipelineName} ` +
                    `${buildData.jobName} #${buildData.buildId}`;
                const message = `Build status: ${buildData.status}` +
                    `\nBuild link:${buildData.buildLink}`;
                const html = tinytim.renderFile(path.resolve(__dirname, './template/email.html'), {
                    buildStatus: buildData.status,
                    buildLink: buildData.buildLink,
                    buildId: buildData.buildId,
                    statusColor: COLOR_MAP[buildData.status]
                });

                const mailOpts = {
                    from: this.config.from,
                    to: buildData.settings.email.addresses,
                    subject,
                    text: message,
                    html
                };

                const smtpConfig = {
                    host: this.config.host,
                    port: this.config.port
                };

                return resolve(emailer(mailOpts, smtpConfig));
            });
        });
    }
}

module.exports = EmailNotifier;
