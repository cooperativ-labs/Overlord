# {{readme.title}}

{{readme.intro}}

{{#if readme.whatShipsHeading}}## {{readme.whatShipsHeading}}
{{/if}}
{{#if readme.whatShipsLead}}{{readme.whatShipsLead}}
{{/if}}
{{#if readme.whatShips}}
{{readme.whatShips}}
{{/if}}
{{#if readme.afterWhatShips}}

{{readme.afterWhatShips}}
{{/if}}

## Requirements

{{readme.requirements}}

{{#if readme.installLocalDev}}
## Install (local dev)

```bash
{{readme.installLocalDev}}
```
{{/if}}
{{#if readme.installMarketplaceTitle}}## {{readme.installMarketplaceTitle}}
{{/if}}
{{#if readme.installMarketplaceLead}}
{{readme.installMarketplaceLead}}

{{/if}}
{{#if readme.installMarketplace}}

```bash
{{readme.installMarketplace}}
```
{{/if}}
{{#if readme.installMarketplaceNote}}
{{readme.installMarketplaceNote}}
{{/if}}
{{#if readme.toolCoverageHeading}}

## {{readme.toolCoverageHeading}}

{{readme.toolCoverageIntro}}

{{readme.toolCoverage}}

{{readme.toolCoverageNote}}
{{/if}}
{{#if readme.skillCoverageHeading}}

## {{readme.skillCoverageHeading}}

{{readme.skillCoverage}}
{{/if}}
{{#if readme.namespacedComponentsHeading}}

## {{readme.namespacedComponentsHeading}}

{{readme.namespacedComponentsIntro}}

{{readme.namespacedComponents}}

{{readme.namespacedComponentsNote}}
{{/if}}
{{#if readme.appSurfaceStatusHeading}}

## {{readme.appSurfaceStatusHeading}}

{{readme.appSurfaceStatus}}
{{/if}}
