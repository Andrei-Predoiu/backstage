/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { InputError } from '@backstage/errors';
import {
  GithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Octokit } from 'octokit';
import { throttling } from '@octokit/plugin-throttling';
import { parseRepoUrl } from '../publish/util';
import { getOctokitOptions } from './helpers';

/**
 * Creates a new action that dispatches a GitHub Action workflow for a given branch or tag.
 * @public
 */
export function createGithubActionsDispatchAction(options: {
  integrations: ScmIntegrations;
  githubCredentialsProvider?: GithubCredentialsProvider;
}) {
  const { integrations, githubCredentialsProvider } = options;

  return createTemplateAction<{
    repoUrl: string;
    workflowId: string;
    branchOrTagName: string;
    workflowInputs?: { [key: string]: string };
    token?: string;
  }>({
    id: 'github:actions:dispatch',
    description:
      'Dispatches a GitHub Action workflow for a given branch or tag',
    schema: {
      input: {
        type: 'object',
        required: ['repoUrl', 'workflowId', 'branchOrTagName'],
        properties: {
          repoUrl: {
            title: 'Repository Location',
            description: `Accepts the format 'github.com?repo=reponame&owner=owner' where 'reponame' is the new repository name and 'owner' is an organization or username`,
            type: 'string',
          },
          workflowId: {
            title: 'Workflow ID',
            description: 'The GitHub Action Workflow filename',
            type: 'string',
          },
          branchOrTagName: {
            title: 'Branch or Tag name',
            description:
              'The git branch or tag name used to dispatch the workflow',
            type: 'string',
          },
          workflowInputs: {
            title: 'Workflow Inputs',
            description:
              'Inputs keys and values to send to GitHub Action configured on the workflow file. The maximum number of properties is 10. ',
            type: 'object',
          },
          token: {
            title: 'Authentication Token',
            type: 'string',
            description: 'The GITHUB_TOKEN to use for authorization to GitHub',
          },
        },
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        workflowId,
        branchOrTagName,
        workflowInputs,
        token: providedToken,
      } = ctx.input;

      ctx.logger.info(
        `Dispatching workflow ${workflowId} for repo ${repoUrl} on ${branchOrTagName}`,
      );

      const { owner, repo } = parseRepoUrl(repoUrl, integrations);

      if (!owner) {
        throw new InputError('Invalid repository owner provided in repoUrl');
      }

      const ThrottledRetry = Octokit.plugin(throttling);
      const client = new ThrottledRetry({
        ...(await getOctokitOptions({
          integrations,
          repoUrl,
          credentialsProvider: githubCredentialsProvider,
          token: providedToken,
        })),
        throttle: {
          onRateLimit: (_: number, opts: any) => {
            // retry three times
            return opts.request.retryCount < 4;
          },
          onSecondaryRateLimit: (_: number, opts: any) => {
            // retry three times
            return opts.request.retryCount < 4;
          },
          fallbackSecondaryRateRetryAfter: 5,
        },
      });

      await client.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflowId,
        ref: branchOrTagName,
        inputs: workflowInputs,
      });

      ctx.logger.info(`Workflow ${workflowId} dispatched successfully`);
    },
  });
}
