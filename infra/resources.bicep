@description('The location used for all deployed resources')
param location string = resourceGroup().location

@description('Tags that will be applied to all resources')
param tags object = {}


param omnisyncIngestorExists bool
@secure()
param omnisyncIngestorDefinition object

@description('Id of the user or app to assign application roles')
param principalId string

var abbrs = loadJsonContent('./abbreviations.json')
var resourceTokenSuffix = '-prod-ne-01'
var resourceTokenSuffixWithoutDashes = replace(resourceTokenSuffix, '-', '')
var resourceTokenApp = 'omnisyncingestor'
var resourceTokenRandom = substring(uniqueString(subscription().id, resourceGroup().id, location),0,2)

// Monitor application with Azure Monitor
module monitoring 'br/public:avm/ptn/azd/monitoring:0.1.0' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceTokenApp}${resourceTokenSuffix}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceTokenApp}${resourceTokenSuffix}'
    applicationInsightsDashboardName: '${abbrs.portalDashboards}${resourceTokenApp}${resourceTokenSuffix}'
    location: location
    tags: tags
  }
}

// Container registry
module containerRegistry 'br/public:avm/res/container-registry/registry:0.1.1' = {
  name: 'registry'
  params: {
    name: '${abbrs.containerRegistryRegistries}${resourceTokenApp}${resourceTokenRandom}${resourceTokenSuffixWithoutDashes}'
    location: location
    acrAdminUserEnabled: true
    tags: tags
    publicNetworkAccess: 'Enabled'
    roleAssignments:[
      {
        principalId: omnisyncIngestorIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
      }
    ]
  }
}

// Container apps environment
module containerAppsEnvironment 'br/public:avm/res/app/managed-environment:0.4.5' = {
  name: 'container-apps-environment'
  params: {
    logAnalyticsWorkspaceResourceId: monitoring.outputs.logAnalyticsWorkspaceResourceId
    name: '${abbrs.appManagedEnvironments}${resourceTokenApp}${resourceTokenSuffix}'
    location: location
    zoneRedundant: false
  }
}

module omnisyncIngestorIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.1' = {
  name: 'omnisyncIngestoridentity'
  params: {
    name: '${abbrs.managedIdentityUserAssignedIdentities}${resourceTokenApp}${resourceTokenSuffix}'
    location: location
  }
}

module omnisyncIngestorFetchLatestImage './modules/fetch-container-image.bicep' = {
  name: 'omnisyncIngestor-fetch-image'
  params: {
    exists: omnisyncIngestorExists
     name: '${abbrs.appContainerApps}${resourceTokenApp}${resourceTokenSuffix}'
  }
}

var omnisyncIngestorAppSettingsArray = filter(array(omnisyncIngestorDefinition.settings), i => i.name != '')
var omnisyncIngestorSecrets = map(filter(omnisyncIngestorAppSettingsArray, i => i.?secret != null), i => {
  name: i.name
  value: i.value
  secretRef: i.?secretRef ?? take(replace(replace(toLower(i.name), '_', '-'), '.', '-'), 32)
})
var omnisyncIngestorEnv = map(filter(omnisyncIngestorAppSettingsArray, i => i.?secret == null), i => {
  name: i.name
  value: i.value
})

module omnisyncIngestor 'br/public:avm/res/app/container-app:0.8.0' = {
  name: 'omnisyncIngestor'
  params: {
    name: '${abbrs.appContainerApps}${resourceTokenApp}${resourceTokenSuffix}'
    ingressTargetPort: 80
    scaleMinReplicas: 1
    scaleMaxReplicas: 10
    secrets: {
      secureList:  union([
      ],
      map(omnisyncIngestorSecrets, secret => {
        name: secret.secretRef
        value: secret.value
      }))
    }
    containers: [
      {
        image: omnisyncIngestorFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        name: 'main'
        resources: {
          cpu: json('0.5')
          memory: '1.0Gi'
        }
        env: union([
          {
            name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
            value: monitoring.outputs.applicationInsightsConnectionString
          }
          {
            name: 'AZURE_CLIENT_ID'
            value: omnisyncIngestorIdentity.outputs.clientId
          }
          {
            name: 'PORT'
            value: '80'
          }
        ],
        omnisyncIngestorEnv,
        map(omnisyncIngestorSecrets, secret => {
            name: secret.name
            secretRef: secret.secretRef
        }))
      }
    ]
    managedIdentities:{
      systemAssigned: false
      userAssignedResourceIds: [omnisyncIngestorIdentity.outputs.resourceId]
    }
    registries:[
      {
        server: containerRegistry.outputs.loginServer
        identity: omnisyncIngestorIdentity.outputs.resourceId
      }
    ]
    environmentResourceId: containerAppsEnvironment.outputs.resourceId
    location: location
    tags: union(tags, { 'azd-service-name': 'omnisync-ingestor' })
  }
}
// Create a keyvault to store secrets
module keyVault 'br/public:avm/res/key-vault/vault:0.6.1' = {
  name: 'keyvault'
  params: {
    name: '${abbrs.keyVaultVaults}omnisync${resourceTokenRandom}${resourceTokenSuffix}'
    location: location
    tags: tags
    enableRbacAuthorization: false
    enablePurgeProtection: false
    accessPolicies: [
      {
        objectId: principalId
        permissions: {
          secrets: [ 'get', 'list' ]
        }
      }
      {
        objectId: omnisyncIngestorIdentity.outputs.principalId
        permissions: {
          secrets: [ 'get', 'list' ]
        }
      }
    ]
    secrets: [
    ]
  }
}
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_KEY_VAULT_ENDPOINT string = keyVault.outputs.uri
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output AZURE_RESOURCE_OMNISYNC_INGESTOR_ID string = omnisyncIngestor.outputs.resourceId
