# Types

## Gotemplates

Go’s [`text/template`](https://golang.org/pkg/text/template) package provides a rich templating language for text templates. In addition to the constructs and functions provided by go templates, inter operator supports a few additional function. Type `gotemplates` is supported for all actions including `status` and `clusterSelector` templates.

### Additional Functions

#### Sprig

All the functions provided by [sprig](http://masterminds.github.io/sprig/) library(v2.22) is supported by interoperator.


#### Custom Functions
```
b64enc          Returns the base64 encoded output of its argument string

b64dec          Takes a base64 encoded string and returns the base64 decoded output
                of its argument. Will return an error in case the input cannot be
                decoded in base64.

unmarshalJSON   Takes a stringified JSON as input converts it to a map of type
                map[string]interface{}. Returns an error if it fails to convert.

marshalJSON     The function encodes an item into a JSON string. If the item
                cannot be converted to JSON the function will return an error.
                The input argument is expected to be of type map[string]interface{}

toToml          The function encodes an item into a TOML string. If the item
                cannot be converted to TOML the output string, the output is the error message. 
                The input argument is expected to be of type map[string]interface{}

toYaml          The function encodes an item into a TOML string. If the item
                cannot be converted to TOML the output string, the output is an empty string. 
                The input argument is expected to be of type map[string]interface{}

fromYaml        Takes a stringified YAML as input converts it to a map of type map[string]interface{}.
                On error return a map with key "Error" containing the error message.

toJson          The function encodes an item into a JSON string. If the item
                cannot be converted to JSON, the output is an empty string.
                The input argument is expected to be of type map[string]interface{}

fromJson        Takes a stringified JSON as input converts it to a map of type map[string]interface{}.
                On error return a map with key "Error" containing the error message.
```

### Debugging
For validating gotemplates we have a small go [program](https://github.com/vivekzhere/gotemplate-test) which renders a go template and prints the output. You can use it to try out go templates.

## Helm

[Helm](https://helm.sh/) is regarded as the package manager for Kubernetes. For `provision` and `bind` templates helm charts can be used as follows.

Field Name| Required | Description
--- | --- | ---
**action** | Yes | The action for which the template is used. Helm charts are supported only for `provision` and `bind` actions.
**type** | Yes | The type of the template. Must be `helm` for helm charts.
**url** | Yes | The URL to the helm chart. Url must point to the helm chart `tgz`.
**content** | No | The `gotemplate` for generating the `values` for the helm release. Refer [here](#gotemplates) for gotemplates docs. For `provision` and `bind` actions, *SFService* object (as `.service`), *SFPlan* object (as `.plan`) and *SFServiceInstance* object (as `.instance`) are available within the gotemplate to use. For `bind` action in addition to these objects *SFServiceBinding* object (as `.binding`) is also available. Refer [Service Fabrik Inter-operator Custom Resources](./Interoperator.md#service-fabrik-inter-operator-custom-resources) for details about these objects. The template must render to a valid yaml string which will be provided to the helm release as the custom `values`.
**contentEncoded** | No | The gotemplate described in `content` field as a base64 encoded string. This field is used only if `content` field is empty.

### Release Name
For `provision` action the name of the helm release is calculated as `in-<Adler-32 checksum of instanceID>`. Within `gotemplates` this can be calculated as:
```
{{- $name := "" }}
{{- with .instance.metadata.name }} {{ $name = (printf "in-%s" (adler32sum .)) }} {{ end }}
``` 

For `bind` action the name of the helm release is calculated as `in-<Adler-32 checksum of bindingID>`. Within `gotemplates` this can be calculated as:
```
{{- $name := "" }}
{{- with .binding.metadata.name }} {{ $name = (printf "in-%s" (adler32sum .)) }} {{ end }}
```

This release name is set this way to ensure it starts with a character and is not too long.

### Example

A sample templates for a plan which uses helm as the template type for `provision` action is given below.

```
  - action: provision
    type: helm
    url: https://kubernetes-charts.storage.googleapis.com/postgresql-8.0.0.tgz
    content: |
      {{- $name := "" }}
      {{- with .instance.metadata.name }} {{ $name = (printf "in-%s" (adler32sum .)) }} {{ end }}
      postgresqlPassword: {{ $name }}-password
  - action: sources
    type: gotemplate
    content: |
      {{- $name := "" }}
      {{- with .instance.metadata.name }} {{ $name = (printf "in-%s" (adler32sum .)) }} {{ end }}
      {{- $namespace := "" }}
      {{- with .instance.metadata.namespace }} {{ $namespace = . }} {{ end }}
      statefulset:
        apiVersion: "apps/v1"
        kind: StatefulSet
        name: {{ $name }}-postgresql
        namespace: {{ $namespace }}
      secret:
        apiVersion: v1
        kind: Secret
        name: {{ $name }}-postgresql
        namespace: {{ $namespace }}
      service:
        apiVersion: v1
        kind: Service
        name: {{ $name }}-postgresql
        namespace: {{ $namespace }}
  - action: status
    type: gotemplate
    content: |
      {{ $stateString := "in progress" }}
      {{ $readyReplicas := 0 }}
      {{- with .statefulset.status.readyReplicas }}
        {{- $readyReplicas = . }}
      {{- end }}
      {{- with .statefulset.status.replicas }}
        {{- if eq . $readyReplicas }}
          {{- $stateString = "succeeded" }}
        {{- end }}
      {{- end }}
      provision:
        state: {{ printf "%s" $stateString }}
        description: 
      {{- $host := "" }}
      {{- with .service.spec.clusterIP }} {{ $host = . }} {{ end }}
      {{- $pass := "" }}
      {{- $secretData := dict }}
      {{- with .secret.data }} {{ $secretData = . }} {{ end }}
      {{- if (hasKey $secretData "postgresql-password") }}
          {{ $pass = (b64dec (get $secretData "postgresql-password")) }}
      {{- end}}
      {{- $stateString = "in progress" }}
      {{- if and (not (eq $host "")) (not (eq $pass "")) }}
        {{- $stateString = "succeeded" }}
      {{- end }}
      bind:
        state: {{ printf "%s" $stateString }}
        error: ""
        response: {{ (printf `"{ \"credentials\":{\"host\": \"%s\", \"username\": \"postgres\", \"password\": \"%s\"} }"` $host  $pass ) }}
      {{- $stateString = "succeeded" }}
      unbind:
        state: {{ printf "%s" $stateString }}
        error: ""
      {{- $stateString = "in progress" }}
      {{- with .statefulset }} {{ with .metadata.deletionTimestamp }} {{ $stateString = "in progress" }} {{ end }} {{ else }} {{ $stateString = "succeeded" }}  {{ end }}
      deprovision:
        state: {{ printf "%s" $stateString }}
        error: ""
  - action: bind
    type: gotemplate
    content: "---"
```

# Actions

## Provision
The `provision` template must render and generate a valid yaml for a kubernetes resource(s). For `provision` action, *SFService* object (as `.service`), *SFPlan* object (as `.plan`) and *SFServiceInstance* object (as `.instance`) are available as template variables within the gotemplate to use.

Supported types | Required | Template Variables
--- | --- | ---
`gotemplate`, `helm` | Yes | `.service`, `.plan`, `.instance`

The `provision` template is used to determine the kubernetes resources to be created (or updated) on provision (or update) osb calls.

## Bind
The `bind` template must render and generate a valid yaml for a kubernetes resource(s). For `bind` action *SFServiceBinding* object (as `.binding`) is also available as template variables within the gotemplate to use. 

Supported types | Required | Template Variables
--- | --- | ---
`gotemplate`, `helm` | Yes | `.service`, `.plan`, `.instance`, `.binding`

The `bind` template is used to determine the kubernetes resources to be created bind osb calls. If no kubernetes resources are to be created on a bind call the following `bind` template can be used.
```
- action: bind
  type: gotemplate
  content: "---"
```

The `bind` template also supports updating existing resources created using provision template. If existing resources are updated in `bind` template, it is mandatory to provide and `unbind` template. For example if a postgresql resource is created using `provision` template and during binding it needs to be updated, the `bind` template can look like 
```
- action: bind
  type: gotemplate
  content: |
    {{- $bindingId := "" }}
    {{- with .binding.metadata.name }} {{ $bindingId = . }} {{ end }}
    {{- $postgresql := .postgresql }}
    {{- $postgresqlSpec := get $postgresql "spec" }}
    {{- $users := get $postgresqlSpec "users" }}
    {{- $_ := set $users $bindingId (list "superuser") }}
    {{ toYaml $postgresql }}
```

## Unbind
The `unbind` template is used during unbind (delete service key) osb action. The `unbind` template is an optional template. It is mandatory only when existing resources are updated in `bind` template. If `unbind` template is not provided the resources created during `bind` action are deleted during the `unbind` action. The `unbind` template, if provided, must render and generate a valid yaml for a kubernetes resource(s). If `unbind` template is provided, during the `unbind` action instead of deleting any resources created during `bind` action, the `unbind` template is rendered and the output kubernetes resource(s) are applied.  A sample unbind template will look like
```
- action: unbind
  type: gotemplate
  content: |
    {{- $bindingId := "" }}
    {{- with .binding.metadata.name }} {{ $bindingId = . }} {{ end }}
    {{- $postgresql := .postgresql }}
    {{- $postgresqlSpec := get $postgresql "spec" }}
    {{- $users := get $postgresqlSpec "users" }}
    {{- $_ := unset $users $bindingId }}
    {{ toYaml $postgresql }}
```

## Sources
The `sources` template must render and generate a valid yaml. This yaml defines the kubernetes objects which are required as template variables for rendering the `status` template. A kubernetes object can be identified by: 
Field Name | Required | Description
--- | --- | ---
apiVersion | Yes | The version of the Kubernetes API for this object
kind | Yes | The Kind of the object
name | Yes | The name of the object 
namespace | Yes | The namespace of the object

Sample source template
```
{{- $name := "" }}
{{- with .instance.metadata.name }} {{ $name = . {{ end }}
{{- $namespace := "" }}
{{- with .instance.metadata.namespace }} {{ $namespace = . }} {{ end }}
statefulset:
  apiVersion: "apps/v1"
  kind: StatefulSet
  name: {{ $name }}
  namespace: {{ $namespace }}
scrt:
  apiVersion: v1
  kind: Secret
  name: {{ $name }}
  namespace: {{ $namespace }}
```

Here two kubernetes object are specified in the sources template.

Supported types | Required | Template Variables
--- | --- | ---
`gotemplate` | Yes | `.service`, `.plan`, `.instance`, `.binding` (when rendered in the context of binding)

The `sources` template also determines the resources on which interoperator watches for a change. The provision controller of interoperator watches on a resource only if the resource is created by interoperator during provisioning and the resource is specified in the `sources` template. Similarly the binding controller of interoperator watches on a resource only if the resource is created/updated by interoperator during binding and the resource is specified in the `sources` template.  


## Status

The `status` template is used for deriving the current state of objects. This is used for all the osb actions namely provision, deprovision, update, bind and unbind. Along with *SFService* object (as `.service`), *SFPlan* object (as `.plan`), *SFServiceInstance* object (as `.instance`) and  SFServiceBinding* object (as `.binding`) (when rendered in the context of binding), the objects specified in the `sources` template are also available as template variables within the gotemplate to use. The variable name for an object is the same as key for that object in the `sources` template. For example, with the sample template above as `sources` template, we can use `.scrt` in the status template to refer to the secret. If an object cannot be fetched from kubernetes api server when rendering the `status` template, the corresponding template variable will not be set. So any access to these objects must be guarded with the `with` construct of go template, so the templates wont fail to render if one or more objects are not found.

Supported types | Required | Template Variables
--- | --- | ---
`gotemplate` | Yes | `.service`, `.plan`, `.instance`, `.binding` (when rendered in the context of binding) and objects specified in the `sources` template

The `status` template should render and generate a valid yaml. Rendered yaml should have following distinct fields:`.provision`, `.bind`, `.unbind` and `.deprovision`. Note that only relevant fields from the rendered template will be used while updating the status and other fields will be ignored. For example, while updating status during `provision` operation, only the `.provision` field from the rendered template is used. Following are the various fields supported in the rendered status template.
### Supported status template fields under `.provision` and `.deprovision` field
Field | Type | Required | Description
--- | --- | --- | ---
`state` | string | Yes | It should indicate current state of the operation, e.g., `in progress`, `failed`, `succeeded` etc.
`response` | string | No | It can be used to indicate more details about the operation.
`error` | string | No | It can be used to provide error details for failure scenario.
`dashboardUrl` | string | No | If the service supports dashboards, this field can be used to provide dashboardUrl for the given service instance.
`instanceUsable` | string | No | This field can be used to indicate usability of the instance in case of failed update and delete operations. This is interpreted as per [OSB Specification](https://github.com/openservicebrokerapi/servicebroker/blob/master/spec.md#service-broker-errors). Value should be either "true" or "false." 
`updateRepeatable` | string | No | This field can be used to indicate if the failed update operation is repeatable. This is interpreted as per [OSB Specification](https://github.com/openservicebrokerapi/servicebroker/blob/master/spec.md#service-broker-errors). Value should be either "true" or "false."

### Supported status template fields for `.bind` and `.unbind` field
Field | Type | Required | Description
--- | --- | --- | ---
`state` | string | Yes | It should indicate current state of the operation, e.g., `in progress`, `failed`, `succeeded` etc.
`response` | string | No | It can be used to indicate more details about the operation. In case of binding operation, content of this field is treated as binding credentials.
`error` | string | No | It can be used to provide error details for failure scenario.

## Cluster Selector
The `clusterSelector` template must render and generate a valid kubernetes [label selector](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#label-selectors). This template is used for [Label Selector based Scheduler](./Interoperator.md#label-selector-based-scheduler).

Supported types | Required | Template Variables
--- | --- | ---
`gotemplate` | No | `.service`, `.plan`, `.instance`
