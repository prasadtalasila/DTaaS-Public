# OAuth for React Client

To enable user authorization on the DTaaS React client website,
the OAuth authorization protocol is used, specifically the PKCE authorization flow.
The following steps describe the setup process:

**1. Choose a GitLab Server:**

- OAuth authorization must be set up on a GitLab server.
  An on-premise GitLab installation is preferrable to commercial
  <https://gitlab.com>.
- The
  [GitLab Omnibus Docker](https://docs.gitlab.com/ee/install/docker.html)
  can be used for this purpose.
- The OAuth application should be configured as
  an [instance-wide authorization type](https://docs.gitlab.com/ee/integration/oauth_provider.html#create-an-instance-wide-application).

**2. Determine the Website's Hostname:**

- Before setting up OAuth on GitLab, the hostname for the website must be determined.
  Using a self-hosted GitLab instance is recommended, which will be used in
  other parts of the DTaaS application.

**3. Define Callback and Logout URLs:**

- For the PKCE authorization flow to function correctly, two URLs are required:
  a callback URL and a logout URL.
- The callback URL informs the OAuth provider of the page where
  signed-in users should be redirected. It differs from the landing
  homepage of the DTaaS application.
- The logout URL specifies where users will be directed after logging out.

**4. OAuth Application Creation:**

- During the creation of the OAuth application on GitLab,
  the scope must be specified.
  The openid, profile, read_user, read_repository, and api scopes
  should be selected.

  ![Creation of Client OAuth Application](client-oauth-name.png)

**5. Application ID:**

- After successfully creating the OAuth application, GitLab generates
  an application ID. This is a long string of HEX values required for
  the configuration files.

  ![Scopes for Client OAuth Application](client-oauth-scopes.png)

**6. Required Information from OAuth Application:**

- The following information from the OAuth application
  registered on GitLab is required:

| GitLab Variable Name | Variable Name in Client env.js | Default Value                                      |
| -------------------- | ------------------------------ | -------------------------------------------------- |
| OAuth Provider       | REACT_APP_AUTH_AUTHORITY       | [https://gitlab.foo.com/](https://gitlab.foo.com/) |
| Application ID       | REACT_APP_CLIENT_ID            |                                                    |
| Callback URL         | REACT_APP_REDIRECT_URI         | [https://foo.com/Library](https://foo.com/Library) |
| Scopes               | REACT_APP_GITLAB_SCOPES        | openid, profile, read_user, read_repository, api   |

  ![Summary for Client OAuth Application](client-oauth-id.png)

**7. Create User Accounts:**

User accounts must be created in GitLab for all usernames chosen during
installation. The _trial_ installation script includes two default
usernames - _user1_ and _user2_. For all other installation scenarios,
accounts with specific usernames must be created on GitLab.
