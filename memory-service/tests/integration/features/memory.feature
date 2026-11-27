Feature: Remembering and recalling what the owner tells the chief of staff
  Scenario: A bot archives a memory and recalls it
    Given the owner told the CoS "MockTest's client is Acme Ltd" in project "mocktest"
    When the nightly dream runs
    Then recalling "who is the client" in project "mocktest" returns "MockTest's client is Acme Ltd"

  Scenario: A forgotten memory is no longer recalled
    Given the owner told the CoS "MockTest's client is Acme Ltd" in project "mocktest"
    And the nightly dream has run
    When the CoS forgets "MockTest's client is Acme Ltd" on the owner's confirmation
    Then recalling "who is the client" in project "mocktest" returns nothing

  Scenario: A superseded memory points to its successor
    Given the owner told the CoS "MockTest's client is Acme Ltd" in project "mocktest"
    And the nightly dream has run
    And the owner told the CoS "MockTest's client is Globex Ltd" in project "mocktest"
    And the nightly dream has run
    When the CoS replaces "MockTest's client is Acme Ltd" with "MockTest's client is Globex Ltd"
    Then the old memory is reported superseded
    And recalling "who is the client" in project "mocktest" returns "MockTest's client is Globex Ltd"
    And recalling "who is the client" in project "mocktest" does not return "MockTest's client is Acme Ltd"

  Scenario: The nightly dream writes a project overview
    Given project "mocktest" has no overview
    And the owner told the CoS "MockTest's client is Acme Ltd" in project "mocktest"
    When the nightly dream runs
    Then the overview of project "mocktest" is the one the dream wrote
    And the last dream succeeded
