Feature: Publishing an artifact for a project
  Scenario: A published bundle appears in the catalog under its project
    Given a registered project "procurement" with an HTML bundle
    When the artifact is published
    Then the catalog lists it under "procurement"
    And its page, stylesheet and script are served
    And unregistered files are not served

  Scenario: Removing a project removes its artifacts
    Given a published artifact in project "procurement"
    When the project is removed
    Then the artifact is no longer listed or served
